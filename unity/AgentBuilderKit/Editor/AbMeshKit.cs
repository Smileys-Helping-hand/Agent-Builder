// Agent Builder level kit: builds an asset's mesh from its parts when there is
// no Blender model for it. Organic shapes (rocks, foliage) are subdivided
// icospheres displaced by fractal noise with smooth normals, so they read as
// sculpted rather than as Unity primitives; each part lands in the submesh of
// its material slot (0 primary, 1 secondary, 2 glow).
using System.Collections.Generic;
using UnityEngine;
using UnityEngine.Rendering;

namespace AgentBuilder.Levels.EditorTools
{
    public static class AbMeshKit
    {
        class Piece
        {
            public readonly List<Vector3> v = new List<Vector3>();
            public readonly List<int> t = new List<int>();
        }

        public static Mesh Build(AbAsset asset, int seed, out bool[] slotsUsed)
        {
            var verts = new List<Vector3>();
            var normals = new List<Vector3>();
            var uvs = new List<Vector2>();
            var tris = new[] { new List<int>(), new List<int>(), new List<int>() };
            slotsUsed = new bool[3];

            int partIndex = 0;
            foreach (var part in asset.parts)
            {
                partIndex++;
                var piece = Shape(part, seed * 31 + partIndex * 7);
                if (piece == null) continue;
                var m = new Mesh();
                m.indexFormat = IndexFormat.UInt32;
                m.SetVertices(piece.v);
                m.SetTriangles(piece.t, 0);
                m.RecalculateNormals();
                var pn = m.normals;

                var pos = V(part.pos, Vector3.zero);
                var rot = Quaternion.Euler(V(part.rot, Vector3.zero));
                var scl = V(part.scale, Vector3.one);
                int slot = Mathf.Clamp(part.slot, 0, 2);
                slotsUsed[slot] = true;
                int baseIndex = verts.Count;
                for (int i = 0; i < piece.v.Count; i++)
                {
                    var p = rot * Vector3.Scale(piece.v[i], scl) + pos;
                    var n = (rot * new Vector3(pn[i].x / Mathf.Max(scl.x, 1e-3f), pn[i].y / Mathf.Max(scl.y, 1e-3f), pn[i].z / Mathf.Max(scl.z, 1e-3f))).normalized;
                    verts.Add(p);
                    normals.Add(n);
                    uvs.Add(Project(p, n));
                }
                foreach (var idx in piece.t) tris[slot].Add(baseIndex + idx);
                Object.DestroyImmediate(m);
            }

            var mesh = new Mesh { name = asset.id + "_mesh", indexFormat = IndexFormat.UInt32 };
            mesh.SetVertices(verts);
            mesh.SetNormals(normals);
            mesh.SetUVs(0, uvs);
            // Only the slots in use become submeshes, in slot order, so the
            // renderer's material list can be built the same way.
            var used = new List<List<int>>();
            for (int s = 0; s < 3; s++) if (slotsUsed[s]) used.Add(tris[s]);
            mesh.subMeshCount = Mathf.Max(used.Count, 1);
            for (int s = 0; s < used.Count; s++) mesh.SetTriangles(used[s], s);
            mesh.RecalculateBounds();
            mesh.RecalculateTangents();
            return mesh;
        }

        static Vector3 V(float[] a, Vector3 fallback) =>
            a != null && a.Length >= 3 ? new Vector3(a[0], a[1], a[2]) : fallback;

        // Box-projected UVs at a steady texel density, so the detail texture
        // looks the same size on every part.
        static Vector2 Project(Vector3 p, Vector3 n)
        {
            var a = new Vector3(Mathf.Abs(n.x), Mathf.Abs(n.y), Mathf.Abs(n.z));
            if (a.y >= a.x && a.y >= a.z) return new Vector2(p.x, p.z) * 0.5f;
            if (a.x >= a.z) return new Vector2(p.z, p.y) * 0.5f;
            return new Vector2(p.x, p.y) * 0.5f;
        }

        static Piece Shape(AbPart part, int seed)
        {
            switch ((part.shape ?? "box").ToLowerInvariant())
            {
                case "sphere": return Displaced(Icosphere(part.segments > 0 ? Mathf.Clamp(part.segments, 1, 4) : 3), part.noise, seed);
                case "rock": return Displaced(Icosphere(part.segments > 0 ? Mathf.Clamp(part.segments, 1, 4) : 2), Mathf.Max(part.noise, 0.25f), seed);
                case "cylinder": return Cylinder(part.segments > 2 ? part.segments : 20, Mathf.Clamp(part.taper, 0f, 3f), part.noise, seed, true);
                case "cone": return Cylinder(part.segments > 2 ? part.segments : 20, 0f, part.noise, seed, false);
                case "torus": return Torus(part.segments > 2 ? part.segments : 28, 14);
                default: return Box();
            }
        }

        static float Noise3(Vector3 p, int seed)
        {
            float o = seed * 0.6180339f % 97f;
            float sum = 0f, amp = 1f, freq = 1.6f, norm = 0f;
            for (int i = 0; i < 4; i++)
            {
                var q = p * freq;
                float n = (Mathf.PerlinNoise(q.x + o, q.y + o * 1.3f) + Mathf.PerlinNoise(q.y + o * 0.7f, q.z + o) + Mathf.PerlinNoise(q.z + o * 1.9f, q.x + o * 0.4f)) / 3f;
                sum += (n * 2f - 1f) * amp;
                norm += amp;
                amp *= 0.5f;
                freq *= 2.1f;
            }
            return sum / norm;
        }

        static Piece Displaced(Piece piece, float amount, int seed)
        {
            if (amount <= 0f) return piece;
            for (int i = 0; i < piece.v.Count; i++)
            {
                var p = piece.v[i];
                piece.v[i] = p * (1f + Noise3(p * 1.4f, seed) * amount * 0.9f);
            }
            return piece;
        }

        static Piece Icosphere(int subdivisions)
        {
            float t = (1f + Mathf.Sqrt(5f)) / 2f;
            var piece = new Piece();
            var v = piece.v;
            v.AddRange(new[]
            {
                new Vector3(-1, t, 0), new Vector3(1, t, 0), new Vector3(-1, -t, 0), new Vector3(1, -t, 0),
                new Vector3(0, -1, t), new Vector3(0, 1, t), new Vector3(0, -1, -t), new Vector3(0, 1, -t),
                new Vector3(t, 0, -1), new Vector3(t, 0, 1), new Vector3(-t, 0, -1), new Vector3(-t, 0, 1)
            });
            for (int i = 0; i < v.Count; i++) v[i] = v[i].normalized * 0.5f;
            var faces = new List<int>
            {
                0,11,5, 0,5,1, 0,1,7, 0,7,10, 0,10,11, 1,5,9, 5,11,4, 11,10,2, 10,7,6, 7,1,8,
                3,9,4, 3,4,2, 3,2,6, 3,6,8, 3,8,9, 4,9,5, 2,4,11, 6,2,10, 8,6,7, 9,8,1
            };
            var cache = new Dictionary<long, int>();
            int Mid(int a, int b)
            {
                long key = a < b ? ((long)a << 32) + b : ((long)b << 32) + a;
                if (cache.TryGetValue(key, out var found)) return found;
                v.Add(((v[a] + v[b]) * 0.5f).normalized * 0.5f);
                cache[key] = v.Count - 1;
                return v.Count - 1;
            }
            for (int s = 0; s < subdivisions; s++)
            {
                var next = new List<int>(faces.Count * 4);
                for (int i = 0; i < faces.Count; i += 3)
                {
                    int a = faces[i], b = faces[i + 1], c = faces[i + 2];
                    int ab = Mid(a, b), bc = Mid(b, c), ca = Mid(c, a);
                    next.AddRange(new[] { a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca });
                }
                faces = next;
            }
            // This face list already winds outward the way Unity wants:
            // cross(b - a, c - a) points away from the centre.
            piece.t.AddRange(faces);
            return piece;
        }

        // Unit-height cylinder centred on the origin, bottom radius 0.5.
        static Piece Cylinder(int segments, float taper, float noise, int seed, bool capTop)
        {
            var piece = new Piece();
            var v = piece.v;
            int rings = noise > 0f ? 6 : 1;
            for (int r = 0; r <= rings; r++)
            {
                float y = (float)r / rings;
                float radius = Mathf.Lerp(0.5f, 0.5f * taper, y);
                for (int s = 0; s <= segments; s++)
                {
                    float a = (float)s / segments * Mathf.PI * 2f;
                    var p = new Vector3(Mathf.Cos(a) * radius, y - 0.5f, Mathf.Sin(a) * radius);
                    if (noise > 0f && radius > 0f) p = new Vector3(p.x * (1f + Noise3(p * 2f, seed) * noise), p.y, p.z * (1f + Noise3(p * 2f, seed) * noise));
                    v.Add(p);
                }
            }
            int row = segments + 1;
            for (int r = 0; r < rings; r++)
                for (int s = 0; s < segments; s++)
                {
                    int a = r * row + s, b = a + 1, c = a + row, d = c + 1;
                    piece.t.AddRange(new[] { a, c, b, b, c, d });
                }
            // Caps get their own vertices so their edge stays crisp.
            void Cap(float y, float radius, bool up)
            {
                if (radius <= 0f) return;
                int centre = v.Count;
                v.Add(new Vector3(0f, y, 0f));
                for (int s = 0; s <= segments; s++)
                {
                    float a = (float)s / segments * Mathf.PI * 2f;
                    v.Add(new Vector3(Mathf.Cos(a) * radius, y, Mathf.Sin(a) * radius));
                }
                for (int s = 0; s < segments; s++)
                {
                    if (up) piece.t.AddRange(new[] { centre, centre + s + 2, centre + s + 1 });
                    else piece.t.AddRange(new[] { centre, centre + s + 1, centre + s + 2 });
                }
            }
            Cap(-0.5f, 0.5f, false);
            if (capTop) Cap(0.5f, 0.5f * taper, true);
            return piece;
        }

        static Piece Torus(int major, int minor)
        {
            var piece = new Piece();
            for (int i = 0; i <= major; i++)
            {
                float u = (float)i / major * Mathf.PI * 2f;
                for (int j = 0; j <= minor; j++)
                {
                    float w = (float)j / minor * Mathf.PI * 2f;
                    float r = 0.5f + 0.12f * Mathf.Cos(w);
                    piece.v.Add(new Vector3(Mathf.Cos(u) * r, 0.12f * Mathf.Sin(w), Mathf.Sin(u) * r));
                }
            }
            int row = minor + 1;
            for (int i = 0; i < major; i++)
                for (int j = 0; j < minor; j++)
                {
                    int a = i * row + j, b = a + 1, c = a + row, d = c + 1;
                    piece.t.AddRange(new[] { a, b, c, b, d, c });
                }
            return piece;
        }

        static Piece Box()
        {
            var piece = new Piece();
            var n = new[] { Vector3.up, Vector3.down, Vector3.left, Vector3.right, Vector3.forward, Vector3.back };
            foreach (var normal in n)
            {
                var side1 = new Vector3(normal.y, normal.z, normal.x);
                var side2 = Vector3.Cross(normal, side1);
                int start = piece.v.Count;
                piece.v.Add((normal - side1 - side2) * 0.5f);
                piece.v.Add((normal - side1 + side2) * 0.5f);
                piece.v.Add((normal + side1 + side2) * 0.5f);
                piece.v.Add((normal + side1 - side2) * 0.5f);
                piece.t.AddRange(new[] { start, start + 2, start + 1, start, start + 3, start + 2 });
            }
            return piece;
        }
    }
}
