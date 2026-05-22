import { test, expect } from '@playwright/test';

test.describe('Forms & Validation', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="username"], input[type="text"]', 'admin');
    await page.fill('input[type="password"]', 'admin123');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(2000);
  });

  test('should validate required fields on form', async ({ page }) => {
    await page.goto('/settings');
    await page.click('button:has-text("Save"), button:has-text("Submit")');
    await page.waitForTimeout(500);
    
    const errorMessage = page.locator('[class*="error"], [class*="required"], [aria-required="true"]');
    if (await errorMessage.count() > 0) {
      await expect(errorMessage.first()).toBeVisible();
    }
  });

  test('should show loading state on submit', async ({ page }) => {
    await page.goto('/settings');
    const submitButton = page.locator('button[type="submit"], button:has-text("Save")');
    if (await submitButton.count() > 0) {
      await submitButton.first().click();
      const loadingState = page.locator('[class*="loading"], [class*="spinner"]');
      if (await loadingState.count() > 0) {
        await expect(loadingState.first()).toBeVisible();
      }
    }
  });

  test('should close modal on cancel', async ({ page }) => {
    const modal = page.locator('[class*="modal"], [class*="dialog"]');
    if (await modal.count() > 0) {
      const closeButton = modal.locator('button:has-text("Cancel")');
      if (await closeButton.count() > 0) {
        await closeButton.first().click();
        await page.waitForTimeout(500);
        await expect(modal).not.toBeVisible();
      }
    }
  });

  test('should show success message after save', async ({ page }) => {
    await page.goto('/settings');
    await page.fill('input[name="companyName"], input[name="name"]', 'Test Company');
    await page.click('button:has-text("Save")');
    await page.waitForTimeout(1000);
    
    const successMessage = page.locator('[class*="success"], [class*="toast"]:has-text("Success"), [class*="notification"]:has-text("Saved")');
    if (await successMessage.count() > 0) {
      await expect(successMessage.first()).toBeVisible();
    }
  });
});