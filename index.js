const puppeteer = require("puppeteer");
const log = require("loglevel");

require("dotenv-safe").config();

async function focusInputField(page, selector) {
  log.info("Focusing input field");
  const inputField = await page.$(selector);
  await inputField.focus();
  return inputField;
}

async function typeInInputField(inputField, text) {
  log.info("Typing text", text);
  await inputField.type(text, {
    delay: 10
  });
}

async function waitForNavigation(page) {
  log.info("Waiting for the navigation to complete.");
  await page.waitForNavigation({
    waitUntil: "networkidle0"
  });
}

async function startAndNavigateToLoginPage(options) {
  log.info("Setting up browser.");
  const browser = await puppeteer.launch({
    headless: !options.interactiveMode,
    timeout: 60000,
    args: ["--no-sandbox", "--disable-setuid-sandbox"]
  });

  const page = await browser.newPage();
  await page.setViewport({
    width: 1280,
    height: 1280
  });
  await page.goto(process.env.BASE_URL, {
    waitUntil: "domcontentloaded"
  });

  await page.waitFor(1000);
  return { page, browser };
}

async function performLogin(page) {
  log.info("Select name input field.");
  const nameInputField = await focusInputField(
    page,
    process.env.LOGIN_NAME_INPUT
  );
  await typeInInputField(nameInputField, process.env.LOGIN_NAME);

  log.info("Select pin input field.");
  const pinInputField = await focusInputField(
    page,
    process.env.LOGIN_PIN_INPUT
  );
  await typeInInputField(pinInputField, process.env.LOGIN_PIN);

  log.info("Pressing login button.");
  await page.click(process.env.LOGIN_BUTTON);

  await waitForNavigation(page);
}

async function performLogout(page) {
  log.info("Pressing logout button.");
  await page.click(process.env.LOGOUT_BUTTON);
}

async function navigateToTransactions(page) {
  log.info("Navigating to Transaction page.");
  await page.click(process.env.TRANSACTIONS);
}

(async () => {
  log.setLevel(log.levels.TRACE);
  const { page, browser } = await startAndNavigateToLoginPage({
    interactiveMode: true
  });
  await performLogin(page);

  await navigateToTransactions(page);

  await page.waitForSelector(process.env.ACCOUNT_SELECT, {
    visible: true
  });

  const accounts = await page.evaluate(selector => {
    var options = Array.from(document.querySelectorAll(selector));
    return options.map(option => option.textContent.trim());
  }, process.env.ACCOUNT_SELECT);
  log.info(accounts);

  await performLogout(page);
})().catch(error => {
  log.error(error);
});
