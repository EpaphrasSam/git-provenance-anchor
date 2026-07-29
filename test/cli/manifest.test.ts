import { expect } from "chai";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { ethers } from "ethers";
import {
  loadManifest,
  writeManifest,
  type ProvenanceManifest,
} from "../../cli/src/lib/manifest";
import { treeHashToBytes32, bytes32ToTreeHashHex } from "../../cli/src/lib/git-tree";
import { toJson } from "../../cli/src/lib/json";

describe("manifest + padding", () => {
  it("round-trips left-padded SHA-1 tree hashes", () => {
    const hex = "ab".repeat(20);
    const b32 = treeHashToBytes32(hex);
    expect(b32).to.equal(`0x${"00".repeat(12)}${hex}`);
    expect(bytes32ToTreeHashHex(b32)).to.equal(hex);
  });

  it("writes and loads a schema-valid manifest", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpa-manifest-"));
    const manifest: ProvenanceManifest = {
      schemaVersion: 1,
      projectId: ethers.id("example-project"),
      label: "example-project",
      networks: ["opSepolia"],
      extras: [
        {
          path: "dist/**",
          reason: "compiled JavaScript",
          source: "tsc",
        },
      ],
    };
    const written = writeManifest(dir, manifest);
    expect(fs.existsSync(written)).to.equal(true);
    const loaded = loadManifest(written);
    expect(loaded.projectId).to.equal(manifest.projectId);
    expect(loaded.extras?.[0].path).to.equal("dist/**");
  });

  it("serialises the BigInt timestamps that chain reads return", () => {
    const report = { timestamp: 1785341776n, revision: 1 };
    expect(() => JSON.stringify(report)).to.throw(/BigInt/);
    expect(JSON.parse(toJson(report))).to.deep.equal({
      timestamp: "1785341776",
      revision: 1,
    });
  });

  it("rejects an invalid project id", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gpa-manifest-bad-"));
    expect(() =>
      writeManifest(dir, {
        schemaVersion: 1,
        projectId: "not-a-bytes32",
      })
    ).to.throw(/invalid manifest/i);
  });
});
