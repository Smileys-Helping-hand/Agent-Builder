"""
Agent Builder level kit: builds a level plan's assets in Blender and exports
them as FBX into the Unity project, where AgentLevelBuilder.cs picks them up.

    blender -b --factory-startup -P build_level_assets.py -- <level.json> <models dir> [<preview png>]

Each asset is made from the plan's parts (the same parts AbMeshKit.cs uses when
there is no Blender), but modelled the way an artist would: bevelled hard
edges, subdivided and noise-displaced organic shapes, sharp edges kept by angle
and smooth shading elsewhere. Material slots are named <id>_primary,
<id>_secondary and <id>_glow; Unity swaps in its own materials by those names.

Coordinates in the plan are Unity's (left-handed, Y up). They are converted to
Blender's (right-handed, Z up) with an exact change of basis, and the FBX
export converts them back.
"""
import json
import math
import os
import sys

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
if len(argv) < 2:
    print("usage: blender -b -P build_level_assets.py -- <level.json> <models dir> [<preview png>]")
    sys.exit(2)

PLAN_PATH, MODELS_DIR = argv[0], argv[1]
PREVIEW = argv[2] if len(argv) > 2 else None
with open(PLAN_PATH, encoding="utf-8") as f:
    PLAN = json.load(f)
os.makedirs(MODELS_DIR, exist_ok=True)

# Unity (x, y, z) -> Blender (-x, -z, y). A reflection, so rotations convert as C R C^-1.
C = Matrix(((-1, 0, 0), (0, 0, -1), (0, 1, 0)))
C_INV = C.inverted()


def unity_rotation(rot):
    # Unity applies Euler angles Z, then X, then Y.
    rx, ry, rz = (math.radians(a) for a in rot)
    return Matrix.Rotation(ry, 3, "Y") @ Matrix.Rotation(rx, 3, "X") @ Matrix.Rotation(rz, 3, "Z")


def part_matrix(part):
    pos = Vector(part.get("pos", [0, 0, 0]))
    rot = unity_rotation(part.get("rot", [0, 0, 0]))
    scl = part.get("scale", [1, 1, 1])
    local = rot @ Matrix.Diagonal(Vector(scl))
    blender = C @ local @ C_INV
    m = blender.to_4x4()
    m.translation = C @ pos
    return m


def hex_rgba(hex_code, fallback=(0.5, 0.5, 0.5)):
    h = (hex_code or "").lstrip("#")
    if len(h) == 3:
        h = "".join(c * 2 for c in h)
    try:
        rgb = tuple(int(h[i:i + 2], 16) / 255.0 for i in (0, 2, 4))
    except ValueError:
        rgb = fallback
    return tuple(c ** 2.2 for c in rgb) + (1.0,)


def material(name, color, roughness, metallic, glow=None):
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if glow is not None:
        key = "Emission Color" if "Emission Color" in bsdf.inputs else "Emission"
        bsdf.inputs[key].default_value = glow
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = 4.0
    else:
        # Surface variation for the preview render (Unity uses its own detail maps).
        noise = nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 6.0
        noise.inputs["Detail"].default_value = 8.0
        ramp = nodes.new("ShaderNodeValToRGB")
        ramp.color_ramp.elements[0].color = tuple(c * 0.75 for c in color[:3]) + (1,)
        ramp.color_ramp.elements[1].color = color
        links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
        links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = 0.25
        links.new(noise.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def texture(name, kind, scale):
    tex = bpy.data.textures.get(name) or bpy.data.textures.new(name, kind)
    tex.noise_scale = scale
    return tex


def add_primitive(shape, part):
    seg = int(part.get("segments") or 0)
    taper = float(part.get("taper", 1.0))
    if shape == "sphere":
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=max(2, min(seg or 3, 5)), radius=0.5)
    elif shape == "rock":
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=max(3, min(seg or 4, 5)), radius=0.5)
    elif shape == "cylinder":
        bpy.ops.mesh.primitive_cone_add(vertices=max(seg, 24) if seg > 2 else 32, radius1=0.5, radius2=0.5 * max(taper, 0.0), depth=1.0)
    elif shape == "cone":
        bpy.ops.mesh.primitive_cone_add(vertices=max(seg, 24) if seg > 2 else 32, radius1=0.5, radius2=0.0, depth=1.0)
    elif shape == "torus":
        bpy.ops.mesh.primitive_torus_add(major_radius=0.5, minor_radius=0.12, major_segments=48, minor_segments=16)
    else:
        bpy.ops.mesh.primitive_cube_add(size=1.0)
    return bpy.context.active_object


def model_part(part, index, seed):
    shape = (part.get("shape") or "box").lower()
    obj = add_primitive(shape, part)
    obj.name = f"part_{index}"
    noise = float(part.get("noise", 0.0))
    scl = part.get("scale", [1, 1, 1])
    smallest = max(min(abs(s) for s in scl), 0.05)

    if shape in ("box", "cylinder", "cone", "torus"):
        bevel = obj.modifiers.new("Bevel", "BEVEL")
        bevel.width = min(0.05, 0.08 / smallest) if shape == "box" else min(0.03, 0.05 / smallest)
        bevel.segments = 3
        bevel.limit_method = "ANGLE"
        bevel.angle_limit = math.radians(35)
        bevel.harden_normals = True
    if noise > 0 or shape == "rock":
        if shape not in ("sphere", "rock"):
            sub = obj.modifiers.new("Subdivide", "SUBSURF")
            sub.levels = sub.render_levels = 2
            sub.subdivision_type = "SIMPLE"
        amount = max(noise, 0.3) if shape == "rock" else noise
        big = obj.modifiers.new("Shape", "DISPLACE")
        big.texture = texture(f"clouds_{seed}", "CLOUDS", 0.45)
        big.strength = amount * 0.45
        big.texture_coords = "LOCAL"
        if shape == "rock":
            # Voronoi breaks the blob into chipped facets, the "sculpted stone" look.
            facets = obj.modifiers.new("Facets", "DISPLACE")
            facets.texture = texture(f"voronoi_{seed}", "VORONOI", 0.22)
            facets.strength = -amount * 0.18
            facets.texture_coords = "LOCAL"

    obj.matrix_world = part_matrix(part)
    # Bake modifiers and transform into plain mesh data.
    depsgraph = bpy.context.evaluated_depsgraph_get()
    mesh = bpy.data.meshes.new_from_object(obj.evaluated_get(depsgraph))
    mesh.transform(obj.matrix_world)
    slot = max(0, min(int(part.get("slot", 0)), 2))
    for poly in mesh.polygons:
        poly.material_index = slot
    bpy.data.objects.remove(obj, do_unlink=True)
    return mesh


def build_asset(asset, index):
    aid = asset.get("id") or f"asset_{index}"
    bm = bmesh.new()
    for i, part in enumerate(asset.get("parts") or []):
        mesh = model_part(part, i, index * 31 + i)
        bm.from_mesh(mesh)  # appends to what is already in bm
        bpy.data.meshes.remove(mesh)
    if not bm.verts:
        bm.free()
        return None

    # Sharp where the angle is hard, smooth everywhere else.
    for edge in bm.edges:
        edge.smooth = not (edge.is_manifold and edge.calc_face_angle(0) > math.radians(42))
    for face in bm.faces:
        face.smooth = True
    mesh = bpy.data.meshes.new(f"{aid}_mesh")
    bm.to_mesh(mesh)
    bm.free()
    if hasattr(mesh, "use_auto_smooth"):  # Blender < 4.1
        mesh.use_auto_smooth = True
        mesh.auto_smooth_angle = math.radians(42)

    rough = float(asset.get("roughness", 0.6))
    metal = float(asset.get("metallic", 0.0))
    mesh.materials.append(material(f"{aid}_primary", hex_rgba(asset.get("primary")), rough, metal))
    mesh.materials.append(material(f"{aid}_secondary", hex_rgba(asset.get("secondary")), min(rough * 0.8, 1), metal * 0.5))
    mesh.materials.append(material(f"{aid}_glow", hex_rgba(asset.get("glow")), 0.3, 0.0, glow=hex_rgba(asset.get("glow"))))

    obj = bpy.data.objects.new(aid, mesh)
    bpy.context.scene.collection.objects.link(obj)
    weighted = obj.modifiers.new("WeightedNormal", "WEIGHTED_NORMAL")
    weighted.keep_sharp = True
    return obj


def export_fbx(obj, path):
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.fbx(
        filepath=path,
        use_selection=True,
        object_types={"MESH"},
        use_mesh_modifiers=True,
        mesh_smooth_type="OFF",  # custom normals carry the sharp/smooth split
        apply_scale_options="FBX_SCALE_ALL",
        axis_forward="-Z",
        axis_up="Y",
        bake_space_transform=True,
        add_leaf_bones=False,
        path_mode="STRIP",
    )


def render_sheet(objects, path):
    scene = bpy.context.scene
    # The models are already exported; here each is scaled to the same height
    # (a tower and a crystal side by side are both readable) and lined up.
    x = 0.0
    for obj in objects:
        dims = obj.dimensions
        size = max(dims.z, max(dims.x, dims.y) * 0.75, 0.01)
        scale = 2.4 / size
        obj.scale = (scale, scale, scale)
        width = max(dims.x * scale, 1.2)
        obj.location = (x + width / 2, 0, 0)
        x += width + 0.6
    for obj in objects:
        obj.location.x -= x / 2
    for engine in ("BLENDER_EEVEE_NEXT", "BLENDER_EEVEE"):
        try:
            scene.render.engine = engine
            break
        except TypeError:
            continue
    scene.render.resolution_x, scene.render.resolution_y = 1600, 700
    scene.render.film_transparent = False
    world = bpy.data.worlds.new("Sheet") if scene.world is None else scene.world
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.05, 0.06, 0.08, 1)
    sun = bpy.data.objects.new("Sun", bpy.data.lights.new("Sun", "SUN"))
    sun.data.energy = 4.0
    sun.rotation_euler = Euler((math.radians(50), math.radians(10), math.radians(35)))
    scene.collection.objects.link(sun)
    fill = bpy.data.objects.new("Fill", bpy.data.lights.new("Fill", "AREA"))
    fill.data.energy = 600
    fill.data.size = 8
    fill.location = (0, -8, 5)
    fill.rotation_euler = Euler((math.radians(60), 0, 0))
    scene.collection.objects.link(fill)
    cam = bpy.data.objects.new("Camera", bpy.data.cameras.new("Camera"))
    cam.data.lens = 35
    # Frame the row: 35 mm on a 16:7 frame sees about 0.95 × distance across.
    width = max(x, 6)
    cam.location = (0, -width * 1.05, 1.2 + width * 0.18)
    cam.rotation_euler = Euler((math.radians(82), 0, 0))
    scene.collection.objects.link(cam)
    scene.camera = cam
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print(f"[blender] asset sheet {path}")


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    built = []
    for index, asset in enumerate(PLAN.get("assets") or []):
        obj = build_asset(asset, index)
        if obj is None:
            continue
        path = os.path.join(MODELS_DIR, f"{obj.name}.fbx")
        export_fbx(obj, path)
        print(f"[blender] exported {asset.get('id')} -> {path} ({len(obj.data.polygons)} faces)")
        built.append(obj)
    if PREVIEW and built:
        try:
            render_sheet(built, PREVIEW)
        except Exception as error:  # a preview is a nicety; the models are the job
            print(f"[blender] preview not rendered: {error}")
    print(f"[blender] DONE {len(built)} models")


main()
