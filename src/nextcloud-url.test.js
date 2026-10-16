import test from "node:test";
import assert from "node:assert/strict";
import { nextcloudUrl } from "./nextcloud-url.ts";
import { courseTabFromHash, courseTabLink } from "./course-tabs.ts";

test("Nextcloud links preserve share paths, query parameters and fragments", () => {
  const url = "https://nextcloud.example.org/nextcloud/index.php/s/share?path=%2Fnotes#files";
  assert.equal(nextcloudUrl(`  ${url}  `), url);
  assert.equal(nextcloudUrl("http://localhost:8080/s/share"), "http://localhost:8080/s/share");
  assert.equal(nextcloudUrl("HTTPS://NEXTCLOUD.EXAMPLE.ORG"), "https://nextcloud.example.org/");
});

test("Nextcloud links reject malformed URLs, non-web schemes and embedded credentials", () => {
  for (const input of ["", "example.org", "/s/share", "//example.org/s/share", "https://", "https://[", "javascript:alert(1)", "data:text/html,test", "file:///etc/passwd", "https://user:pass@example.org/s/share"]) {
    assert.equal(nextcloudUrl(input), null, input);
  }
});

test("Nextcloud is a course tab with navigable URLs", () => {
  const hash = courseTabLink("course / 1", "nextcloud", "folder");
  assert.equal(courseTabFromHash(hash), "nextcloud");
  assert.equal(new URLSearchParams(hash.slice(1)).get("course"), "course / 1");
  assert.equal(courseTabFromHash("#course=1&tab=unknown"), "files");
});
