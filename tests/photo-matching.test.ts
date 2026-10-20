import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPhotoMatches } from "../src/core/photo-matching.ts";
const person = (id = "p1", value = "Admin_1") => ({
  id,
  value,
  external_id: value,
  name: value,
  has_photo: false,
});
const photo = (id = "a1", original_name = "Admin_ 1.jpg", sha256 = "same") => ({
  id,
  original_name,
  sha256,
  assigned_to: [] as string[],
});
test("bulk matching ignores spaces only when selected and deduplicates identical photos", () => {
  assert.equal(buildPhotoMatches([person()], [photo()], false)[0].ready, false);
  const plan = buildPhotoMatches([person()], [photo(), photo("a2")], true);
  assert.equal(plan[0].ready, true);
  assert.equal(plan[0].duplicates, 1);
  assert.equal(plan[0].asset_id, "a1");
  assert.equal(
    buildPhotoMatches([person()], [photo("a1", "admin_ 1.jpg")], true)[0].ready,
    false,
  );
});
test("bulk matching skips ambiguous IDs, conflicting photos, assigned people and photos in use", () => {
  assert.equal(
    buildPhotoMatches([person(), person("p2", "Admin_ 1")], [photo()], true)[0]
      .ready,
    false,
  );
  assert.equal(
    buildPhotoMatches(
      [person()],
      [photo(), photo("a2", "Admin_1.png", "different")],
      true,
    )[0].ready,
    false,
  );
  assert.equal(
    buildPhotoMatches([{ ...person(), has_photo: true }], [photo()], true)[0]
      .reason,
    "Person already has a photo",
  );
  assert.equal(
    buildPhotoMatches(
      [person()],
      [{ ...photo(), assigned_to: ["p2"] }],
      true,
    )[0].reason,
    "Photo already assigned to another person",
  );
});
