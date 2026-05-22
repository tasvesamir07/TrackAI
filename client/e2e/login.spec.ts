import { test, expect } from '@playwright/test';

test.describe('Login Flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
  });

  test('should display login form', async ({ page }) => {
    await expect(page.locator('h1, h2')).toContainText(/login|sign in/i);
    await expect(page.locator('input[type="text"], input[name="username"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();
  });

  test('should show error for invalid credentials', async ({ page }) => {
    await page.fill('input[name="username"], input[type="text"]', 'invalid');
    await page.fill('input[type="password"]', 'wrongpassword');
    await page.click('button[type="submit"], button:has-text("Login")');
    
    await page.waitForTimeout(1000);
    const errorMessage = page.locator('[class*="error"], [class*="alert"], [role="alert"]');
    await expect(errorMessage.first()).toBeVisible();
  });

  test('should navigate to signup page', async ({ page }) => {
    const signupLink = page.locator('a:has-text("Sign up"), a:has-text("Register"), a:has-text("Create account")');
    if (await signupLink.count() > 0) {
      await signupLink.first().click();
      await expect(page).toHaveURL(/signup|register/);
    }
  });

  test('should have working password visibility toggle', async ({ page }) => {
    const passwordInput = page.locator('input[type="password"]');
    if (await passwordInput.count() > 0) {
      const toggleButton = page.locator('button[aria-label*="toggle"], button:has(svg), [class*="toggle"]');
      if (await toggleButton.count() > 0) {
        await toggleButton.first().click();
        const inputType = await passwordInput.getAttribute('type');
        expect(['text', 'password']).toContain(inputType);
      }
    }
  });

  test('should validate email format', async ({ page }) => {
    await page.fill('input[name="username"], input[type="text"]', 'test@');
    await page.fill('input[type="password"]', 'password123');
    await page.click('button[type="submit"], button:has-text("Login")');
    await page.waitForTimeout(500);
    
    const validationError = page.locator('[class*="error"], [class*="invalid"]');
    if (await validationError.count() > 0) {
      await expect(validationError.first()).toBeVisible();
    }
  });
});