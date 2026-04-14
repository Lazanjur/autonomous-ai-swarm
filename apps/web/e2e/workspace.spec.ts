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
  await expect(
    page.getByPlaceholder("Ask the supervisor to research, analyze, automate, code, or synthesize a complex task.")
  ).toBeVisible();
  const operatorPane = page.locator("aside").last();
  await expect(operatorPane.getByText("Workbench").first()).toBeVisible();

  await operatorPane.getByRole("button", { name: /^Code$/ }).click({ force: true });
  await expect(operatorPane.getByRole("button", { name: /^Code$/ })).toBeVisible();

  await operatorPane.getByRole("button", { name: /^Browser$/ }).click({ force: true });
  await expect(page.getByText(/Open page|Open HTML|Browser work will appear here/i).first()).toBeVisible();

  await operatorPane.getByRole("button", { name: /^Files$/ }).click({ force: true });
  await expect(operatorPane.getByRole("button", { name: /^Files$/ })).toBeVisible();

  await operatorPane.getByRole("button", { name: /^Preview$/ }).click({ force: true });
  await expect(page.getByText("Deployment summary", { exact: true })).toBeVisible();
});

test("left rail collapses into a compact navigation strip and expands back", async ({ page }) => {
  await signInThroughUi(page);
  await page.goto("/app/chat");

  const sidebar = page.locator("aside").first();

  await sidebar.getByRole("button", { name: "Collapse left rail" }).click();
  await expect(sidebar.getByRole("button", { name: "Expand left rail" })).toBeVisible();
  await expect(sidebar.getByRole("link", { name: "New task" })).toBeVisible();

  await sidebar.getByRole("button", { name: "Expand left rail" }).click();
  await expect(sidebar.getByRole("button", { name: "Collapse left rail" })).toBeVisible();
  await expect(sidebar.getByRole("button", { name: "New project" })).toBeVisible();
});

test("workspace switching updates the app shell context", async ({ page }) => {
  await signInThroughUi(page);
  await page.goto("/app/chat");

  const sidebar = page.locator("aside");
  const workspaceSelect = page.locator("select").first();
  await workspaceSelect.selectOption("ws-beta");
  await expect(page).toHaveURL(/workspace=ws-beta/);
  await expect(workspaceSelect).toHaveValue("ws-beta");
  await expect(
    sidebar.getByRole("link", { name: /Run Incident Drill/i }).first()
  ).toBeVisible();
});

test("all tasks navigation switches the active chat thread", async ({ page }) => {
  await signInThroughUi(page);
  await page.goto("/app/chat");

  await page.getByRole("link", { name: /Launch Readiness Audit/i }).click();

  await expect(page).toHaveURL(/thread=thread-launch-audit/);
  await expect(page.getByRole("heading", { name: "Launch Readiness Audit" })).toBeVisible();
});

test("agent, library, plugins, and project creation surfaces stay navigable from the app shell", async ({ page }) => {
  await signInThroughUi(page);
  await page.goto("/app/chat");

  await page.getByRole("link", { name: "Agent" }).click();
  await page.waitForURL(/\/app\/agents/);
  await expect(
    page.getByRole("heading", { name: "Deploy a persistent agent for work that has to keep moving." })
  ).toBeVisible();

  await page.getByRole("link", { name: "Library" }).click();
  await page.waitForURL(/\/app\/library/);
  await expect(
    page.getByRole("heading", {
      name: "Curated workspace memory and reusable deliverables."
    })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Pinned only" })).toBeVisible();

  await page.getByRole("link", { name: "Plugins" }).click();
  await page.waitForURL(/\/app\/plugins/);
  await expect(
    page.getByRole("heading", {
      name: "Connectors and capability packs that extend the workspace."
    })
  ).toBeVisible();

  await page.getByRole("button", { name: "New project" }).click();
  await expect(page.getByRole("dialog", { name: "Create a new project" })).toBeVisible();
  await expect(page.locator("form").getByText("Connectors")).toBeVisible();
});
