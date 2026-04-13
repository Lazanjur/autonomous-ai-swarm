import { expect, test } from "@playwright/test";
import { signInThroughUi } from "./helpers";

test("chat workspace renders the three-column task rail, chat surface, and operator modes", async ({ page }) => {
  await signInThroughUi(page);
  await page.goto("/app/chat");

  const sidebar = page.locator("aside");
  await expect(sidebar.getByRole("button", { name: "New project" })).toBeVisible();
  await expect(
    sidebar.getByRole("link", { name: /Deploy Website After Saving All Files/i }).first()
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "Swarm workspace" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Workbench" })).toBeVisible();

  const operatorPane = page.locator("aside").last();

  await operatorPane.getByRole("button", { name: /^Code$/ }).click({ force: true });
  await expect(operatorPane.getByRole("button", { name: /^Code$/ })).toBeVisible();

  await operatorPane.getByRole("button", { name: /^Browser$/ }).click({ force: true });
  await expect(page.getByText("Swarm Computer").first()).toBeVisible();

  await operatorPane.getByRole("button", { name: /^Files$/ }).click({ force: true });
  await expect(operatorPane.getByRole("button", { name: /^Files$/ })).toBeVisible();

  await operatorPane.getByRole("button", { name: /^Preview$/ }).click({ force: true });
  await expect(page.getByText("Deployment summary", { exact: true })).toBeVisible();
});

test("workspace switching updates the app shell context", async ({ page }) => {
  await signInThroughUi(page);
  await page.goto("/app/chat");

  const sidebar = page.locator("aside");
  await page.locator("select").first().selectOption("ws-beta");
  await expect(page).toHaveURL(/workspace=ws-beta/);
  await expect(page.getByRole("heading", { name: "Operations Sandbox" })).toBeVisible();
  await expect(
    sidebar.getByRole("link", { name: /Run Incident Drill/i }).first()
  ).toBeVisible();
});

test("agents and library surfaces stay navigable from the app shell", async ({ page }) => {
  await signInThroughUi(page);
  await page.goto("/app/chat");

  await page.getByRole("link", { name: "Agents" }).click();
  await page.waitForURL(/\/app\/agents/);
  await expect(
    page.getByRole("heading", { name: "Swarm monitoring for every specialist operator." })
  ).toBeVisible();

  await page.getByRole("link", { name: "Library" }).click();
  await page.waitForURL(/\/app\/library/);
  await expect(
    page.getByRole("heading", {
      name: "Curated workspace memory and reusable deliverables."
    })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Pinned only" })).toBeVisible();
});
