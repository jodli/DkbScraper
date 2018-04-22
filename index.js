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
}

async function performLogout(page) {
  log.info("Pressing logout button.");
  await page.click(process.env.LOGOUT_BUTTON);
}

(async () => {
  log.setLevel(log.levels.TRACE);
  const { page, browser } = await startAndNavigateToLoginPage({
    interactiveMode: true
  });
  await performLogin(page);

  await performLogout(page);
})().catch(error => {
  log.error(error);
});
