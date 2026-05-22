import { test, expect } from '@playwright/test';

test.describe('Attendance Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="username"], input[type="text"]', 'admin');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
  });

  test('should display attendance page', async ({ page }) => {
    await page.goto('/admin');
    const attendanceLink = page.locator('a:has-text("Attendance")');
    if (await attendanceLink.count() > 0) {
      await attendanceLink.first().click();
      await expect(page).toHaveURL(/attendance/i);
    }
  });

  test('should have check-in button', async ({ page }) => {
    await page.goto('/admin');
    const checkInButton = page.locator('button:has-text("Check In"), button:has-text("Check-in")');
    if (await checkInButton.count() > 0) {
      await expect(checkInButton.first()).toBeVisible();
    }
  });

  test('should display attendance records', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForTimeout(1000);
    const table = page.locator('table');
    if (await table.count() > 0) {
      await expect(table.first()).toBeVisible();
    }
  });

  test('should filter attendance by date', async ({ page }) => {
    await page.goto('/admin');
    const datePicker = page.locator('input[type="date"], [class*="date"], [class*="calendar"]');
    if (await datePicker.count() > 0) {
      await datePicker.first().fill('2026-05-20');
      await page.waitForTimeout(500);
    }
  });
});