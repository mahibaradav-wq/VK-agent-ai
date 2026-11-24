export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const dns = await import("node:dns");
    dns.setDefaultResultOrder("ipv4first");
    const { assertAuthSecret, assertProductionCabinetGuards } = await import("@/server/security/secrets");
    assertAuthSecret();
    if (process.env.POLKA_REQUIRE_PROD_SECRETS === "true") {
      assertProductionCabinetGuards();
    }
  }
}
