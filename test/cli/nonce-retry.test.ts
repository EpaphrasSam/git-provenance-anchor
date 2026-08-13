import { expect } from "chai";
import { submitWithNonceRetry } from "../../cli/src/lib/nonce-retry";

describe("anchor nonce retry", () => {
  it("retries a stale nonce with the provider's next nonce", async () => {
    const submitted: number[] = [];
    let nonceReads = 0;

    const result = await submitWithNonceRetry(
      async () => {
        nonceReads++;
        return 0;
      },
      async (nonce) => {
        submitted.push(nonce);
        if (submitted.length === 1) {
          throw {
            code: "NONCE_EXPIRED",
            info: { error: { message: "nonce too low: next nonce 2, tx nonce 0" } },
          };
        }
        return "submitted";
      }
    );

    expect(result).to.equal("submitted");
    expect(submitted).to.deep.equal([0, 2]);
    expect(nonceReads).to.equal(2);
  });

  it("does not retry an unrelated submission error", async () => {
    const error = new Error("insufficient funds");
    let nonceReads = 0;
    let submissions = 0;

    try {
      await submitWithNonceRetry(
        async () => {
          nonceReads++;
          return 0;
        },
        async () => {
          submissions++;
          throw error;
        }
      );
      expect.fail("expected submission to fail");
    } catch (caught) {
      expect(caught).to.equal(error);
    }

    expect(submissions).to.equal(1);
    expect(nonceReads).to.equal(1);
  });
});
