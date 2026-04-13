import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

export async function signInThroughUi(page: Page) {
  await page.goto("/signin");
  await expect(page.getByRole("heading", { name: "Secure access for long-running multi-agent work." })).toBeVisible();
  await page.getByPlaceholder("Email").fill("operator@swarm.e2e");
  await page.getByPlaceholder("Password").fill("DemoPass123!");
  await page.getByRole("button", { name: "Sign In" }).click();
  await expect(page).toHaveURL(/\/app(?:\?.*)?$/);
}
