import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * What happens when the page shell cannot be read from disk.
 *
 * This is the failure that reached production and was the hardest to see: the
 * shell was fetched over HTTP from the deployment's own URL, Deployment
 * Protection answered 302 to Vercel's SSO login, `fetch` followed it, the login
 * page came back 200, and this function served it as Strata's HTML. Every page
 * rendered blank. Nothing threw. Nothing was logged. At every single step
 * something had legitimately succeeded.
 *
 * The shell comes off the filesystem now, so the fetch is only a fallback for
 * `vercel dev`, which serves from Vite and never writes `dist/`. These tests
 * force that fallback by making the disk read fail, and hold it to the rules
 * the original had not been given: never follow a redirect, and never treat
 * anything but a 200 as the page.
 */

vi.mock("node:fs/promises", () => ({
  readFile: vi.fn(async () => {
    throw Object.assign(new Error("ENOENT: no such file"), { code: "ENOENT" });
  }),
}));

const { handler } = await import("../api/html.js");

const ask = () => handler(new Request("https://strata.example/day/500"));

describe("when the shell is not on disk", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const serving = (response: () => Response | Promise<Response>) => {
    vi.stubEnv("VERCEL_URL", "strata-deploy-abc123.vercel.app");
    vi.stubGlobal("fetch", vi.fn(async () => await response()));
  };

  it("refuses a redirect instead of serving whatever it lands on", async () => {
    serving(
      () =>
        new Response("", {
          status: 302,
          headers: { location: "https://vercel.com/sso-api?url=..." },
        }),
    );
    const out = await ask();
    expect(out.status).toBe(503);
    // The detail has to name what happened, or this is undiagnosable from
    // outside all over again.
    expect(out.headers.get("x-strata-detail")).toContain("redirected");
  });

  it("refuses anything that is not a 200", async () => {
    serving(() => new Response("", { status: 500 }));
    const out = await ask();
    expect(out.status).toBe(503);
    expect(out.headers.get("x-strata-detail")).toContain("500");
  });

  it("says so in words, and keeps the failure out of every cache", async () => {
    serving(() => {
      throw new TypeError("fetch failed");
    });
    const out = await ask();
    expect(out.status).toBe(503);
    expect(out.headers.get("cache-control")).toBe("no-store");
    expect(await out.text()).toContain("problem at our end");
    // The address it could not reach, not just "fetch failed".
    expect(out.headers.get("x-strata-detail")).toContain("strata-deploy-abc123.vercel.app");
  });
});
