import { describe, expect, it } from "vitest";

import { describeSubmission, formatMoney, routeFromHash, validateSubmission, whatsappLink, type FieldSpec } from "./site";

describe("routeFromHash", () => {
  it("reads #/… as a page", () => {
    expect(routeFromHash("")).toBe("/");
    expect(routeFromHash("#/")).toBe("/");
    expect(routeFromHash("#/post/hello")).toBe("/post/hello");
  });

  it("treats a plain #section link as staying on the page", () => {
    expect(routeFromHash("#contact")).toBeNull();
    expect(routeFromHash("#newsletter")).toBeNull();
  });
});

describe("formatMoney", () => {
  it("groups thousands with spaces, the South African way", () => {
    expect(formatMoney(4500)).toBe("R 4 500");
    expect(formatMoney(1250000)).toBe("R 1 250 000");
  });

  it("keeps cents only when there are some", () => {
    expect(formatMoney(89.5)).toBe("R 89.50");
    expect(formatMoney(120)).toBe("R 120");
  });
});

describe("whatsappLink", () => {
  it("turns a local number into an international wa.me link", () => {
    expect(whatsappLink("082 555 0142")).toBe("https://wa.me/27825550142");
    expect(whatsappLink("+27 82 555 0142", "Hi")).toBe("https://wa.me/27825550142?text=Hi");
  });
});

describe("form submissions", () => {
  const fields: FieldSpec[] = [
    { name: "name", label: "Name", required: true },
    { name: "email", label: "Email", type: "email" },
    { name: "note", label: "Note", type: "textarea" }
  ];

  it("reports missing required fields and malformed email", () => {
    expect(validateSubmission({}, fields)).toEqual(["Name is required."]);
    expect(validateSubmission({ name: "Ann", email: "nope" }, fields)).toEqual(["Email does not look like an email address."]);
    expect(validateSubmission({ name: "Ann", email: "ann@example.com" }, fields)).toEqual([]);
  });

  it("writes a readable message, skipping empty fields", () => {
    const text = describeSubmission("Enquiry", { name: "Ann", note: "Hello" }, fields);
    expect(text).toBe("Enquiry\n\nName: Ann\nNote: Hello");
  });

  it("adds the page's own details after the fields", () => {
    expect(describeSubmission("Order", { name: "Ann" }, fields, "2 × Soap")).toBe("Order\n\nName: Ann\n\n2 × Soap");
  });
});
