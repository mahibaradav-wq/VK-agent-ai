import { afterEach, describe, expect, it } from "vitest";

import { isSocialPublishLiveEnabled, socialPublishLiveBlockedOutcome } from "@/server/social/publish-live-guard";

describe("social publish live guard", () => {
  const previousLive = process.env.SOCIAL_PUBLISH_LIVE;
  const previousProd = process.env.POLKA_REQUIRE_PROD_SECRETS;

  afterEach(() => {
    if (previousLive === undefined) {
      delete process.env.SOCIAL_PUBLISH_LIVE;
    } else {
      process.env.SOCIAL_PUBLISH_LIVE = previousLive;
    }
    if (previousProd === undefined) {
      delete process.env.POLKA_REQUIRE_PROD_SECRETS;
    } else {
      process.env.POLKA_REQUIRE_PROD_SECRETS = previousProd;
    }
  });

  it("fail-closes under POLKA_REQUIRE_PROD_SECRETS unless SOCIAL_PUBLISH_LIVE is true", () => {
    process.env.POLKA_REQUIRE_PROD_SECRETS = "true";
    delete process.env.SOCIAL_PUBLISH_LIVE;
    expect(isSocialPublishLiveEnabled()).toBe(false);
    process.env.SOCIAL_PUBLISH_LIVE = "1";
    expect(isSocialPublishLiveEnabled()).toBe(false);
    process.env.SOCIAL_PUBLISH_LIVE = "true";
    expect(isSocialPublishLiveEnabled()).toBe(true);
  });

  it("allows local/dev adapters unless SOCIAL_PUBLISH_LIVE is explicitly false", () => {
    delete process.env.POLKA_REQUIRE_PROD_SECRETS;
    delete process.env.SOCIAL_PUBLISH_LIVE;
    expect(isSocialPublishLiveEnabled()).toBe(true);
    process.env.SOCIAL_PUBLISH_LIVE = "false";
    expect(isSocialPublishLiveEnabled()).toBe(false);
  });

  it("returns a permanent failure outcome when blocked", () => {
    expect(socialPublishLiveBlockedOutcome()).toMatchObject({
      kind: "permanent_failure",
      code: "social_publish_disabled",
    });
  });
});
