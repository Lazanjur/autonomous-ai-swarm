import { expect, test } from "@playwright/test";
import { signInThroughUi } from "./helpers";

test("marketing homepage and auth redirect work", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: /The premium AI workspace for complex work that spans research, decisions, software, and automation\./
    })
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Launch Workspace" })).toBeVisible();

  await page.goto("/app/chat");
  await expect(page).toHaveURL(/\/signin$/);
});

test("sign in opens the authenticated app shell", async ({ page }) => {
  await signInThroughUi(page);
  await expect(page.getByRole("heading", { name: "Operational AI for high-stakes work." })).toBeVisible();
  await expect(page.getByText("Task Operating System")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Chat Workspace" })).toBeVisible();
});
