export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertAuthSecret } = await import("@/server/security/secrets");
    assertAuthSecret();
  }
}
