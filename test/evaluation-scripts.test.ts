import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { parseTimeoutMs } from "../scripts/sbom-coverage";
import { comparisonVerdict, manifestForRepo } from "../scripts/tarball-sweep";

describe("evaluation sample scripts", function () {
  it("uses a 900-second SBOM timeout by default", function () {
    expect(parseTimeoutMs(undefined)).to.equal(900_000);
    expect(parseTimeoutMs("30")).to.equal(30_000);
    expect(() => parseTimeoutMs("0")).to.throw("positive number");
  });

  it("applies checked-in tarball fixtures to clean clones", function () {
    const root = path.resolve(__dirname, "..");
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), "gpa-clean-clone-"));
    try {
      expect(manifestForRepo(root, clone, "curl/curl")).to.equal(
        path.join(root, "evaluation", "fixtures", "manifests", "curl.provenance-manifest.json")
      );
      expect(manifestForRepo(root, clone, "libarchive/libarchive")).to.equal(
        path.join(
          root,
          "evaluation",
          "fixtures",
          "manifests",
          "libarchive.provenance-manifest.json"
        )
      );
      expect(manifestForRepo(root, clone, "spf13/cobra")).to.equal(undefined);
    } finally {
      fs.rmSync(clone, { recursive: true, force: true });
    }
  });

  it("prefers a project's own manifest", function () {
    const root = path.resolve(__dirname, "..");
    const clone = fs.mkdtempSync(path.join(os.tmpdir(), "gpa-project-manifest-"));
    const manifest = path.join(clone, ".provenance-manifest.json");
    try {
      fs.writeFileSync(manifest, "{}");
      expect(manifestForRepo(root, clone, "curl/curl")).to.equal(manifest);
    } finally {
      fs.rmSync(clone, { recursive: true, force: true });
    }
  });

  it("does not describe missing paths as every extra file being declared", function () {
    const verdict = comparisonVerdict(false, 0, 2);
    expect(verdict).to.equal(
      "0 undeclared extra file(s), 2 missing path(s); aggregate mismatch"
    );
    expect(verdict).not.to.include("every extra file is declared");
  });
});
