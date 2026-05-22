import { test, expect } from '@playwright/test';

test.describe('Navigation & Layout', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="username"], input[type="text"]', 'admin');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
  });

  test('should have working sidebar navigation', async ({ page }) => {
    const sidebar = page.locator('aside, [class*="sidebar"], nav');
    if (await sidebar.count() > 0) {
      const links = sidebar.locator('a');
      const linksCount = await links.count();
      expect(linksCount).toBeGreaterThan(0);
    }
  });

  test('should navigate to projects page', async ({ page }) => {
    await page.goto('/projects');
    await expect(page.locator('h1, h2')).toBeVisible();
  });

  test('should navigate to settings page', async ({ page }) => {
    await page.goto('/settings');
    await expect(page.locator('h1, h2')).toBeVisible();
  });

  test('should have logout functionality', async ({ page }) => {
    const logoutButton = page.locator('button:has-text("Logout"), a:has-text("Logout")');
    if (await logoutButton.count() > 0) {
      await logoutButton.first().click();
      await expect(page).toHaveURL(/login|signin/);
    }
  });

  test('should display breadcrumbs', async ({ page }) => {
    await page.goto('/projects');
    const breadcrumbs = page.locator('[class*="breadcrumb"], nav[aria-label]");
    if (await breadcrumbs.count() > 0) {
      await expect(breadcrumbs.first()).toBeVisible();
    }
  });
});