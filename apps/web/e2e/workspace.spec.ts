import { expect, test } from "@playwright/test";
import { signInThroughUi } from "./helpers";

test("chat workspace renders the task rail, workflow cockpit, and operator modes", async ({ page }) => {
  await signInThroughUi(page);
  await page.goto("/app/chat");

  const sidebar = page.locator("aside");
  await expect(sidebar.getByRole("button", { name: "New project" })).toBeVisible();
  await expect(
    sidebar.getByRole("link", { name: /Deploy Website After Saving All Files/i }).first()
  ).toBeVisible();
  await expect(page.getByText("Workflow Cockpit", { exact: true })).toBeVisible();
  await expect(page.getByText("Swarm Computer", { exact: true }).first()).toBeVisible();

  await page.getByRole("button", { name: /^Code$/ }).click();
  await expect(page.getByText("Final publish remains gated behind the last verification pass.")).toBeVisible();

  await page.getByRole("button", { name: /^Browser$/ }).click();
  await expect(page.getByText("Swarm Computer")).toBeVisible();

  await page.getByRole("button", { name: /^Files$/ }).click();
  await expect(page.getByText("Workspace files")).toBeVisible();

  await page.getByRole("button", { name: /^Preview$/ }).click();
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
  await expect(
    page.getByRole("heading", { name: "Swarm monitoring for every specialist operator." })
  ).toBeVisible();

  await page.getByRole("link", { name: "Library" }).click();
  await expect(
    page.getByRole("heading", {
      name: "Curated workspace memory and reusable deliverables."
    })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Pinned only" })).toBeVisible();
});
