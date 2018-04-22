const puppeteer = require("puppeteer");
const log = require("loglevel");

require("dotenv-safe").config();

const TransactionType = Object.freeze({ debit: 0, credit: 1 });

async function focusInputField(page, selector) {
  log.info("Focusing input field");
  const inputField = await page.$(selector);
  await inputField.focus();
  return inputField;
}

async function selectAllText(page) {
  log.info("Selecting all text");
  await page.keyboard.down("Control");
  await page.keyboard.down("A");
  await page.keyboard.up("A");
  await page.keyboard.up("Control");
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

async function waitForLoadingElements(page) {
  log.info("Waiting for loading elements to be removed.");
  await page.waitForSelector(process.env.AJAX_LOADING, {
    hidden: true
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
  page.click(process.env.TRANSACTIONS);
  await waitForLoadingElements(page);
  await page.waitFor(1000);
}

async function getAllAccounts(page) {
  log.info("Waiting for account dropdown box appears.");
  await page.waitForSelector(process.env.ACCOUNT_SELECT, {
    visible: true
  });

  log.info("Getting all accounts from dropdown box.");
  const accounts = await page.evaluate(selector => {
    const options = Array.from(document.querySelector(selector).options);
    return options.map(option => {
      return {
        label: option.label,
        value: option.value,
        selected: option.selected
      };
    });
  }, process.env.ACCOUNT_SELECT);
  log.info(accounts);

  return accounts;
}

async function selectAccount(page, account) {
  log.info("Selecting account:", account.label);
  page.select(process.env.ACCOUNT_SELECT, account.value);
  await waitForLoadingElements(page);
  await page.waitFor(1000);
}

async function selectTimeRange(page, timeRange) {
  log.info(
    "Selecting time range for",
    timeRange.type,
    ":",
    timeRange.from,
    "-",
    timeRange.to
  );

  switch (timeRange.type) {
    case TransactionType.credit:
      fromInputSelector = process.env.TRANSACTIONS_CREDIT_FROM;
      toInputSelector = process.env.TRANSACTIONS_CREDIT_TO;
      break;
    case TransactionType.debit:
      fromInputSelector = process.env.TRANSACTIONS_DEBIT_FROM;
      toInputSelector = process.env.TRANSACTIONS_DEBIT_TO;
      break;
    default:
      reject();
  }

  const fromInputField = await focusInputField(page, fromInputSelector);
  await selectAllText(page);
  await typeInInputField(fromInputField, timeRange.from);
  await page.waitFor(1000);

  const toInputField = await focusInputField(page, toInputSelector);
  await selectAllText(page);
  await typeInInputField(toInputField, timeRange.to);
  await page.waitFor(1000);

  page.click(process.env.TRANSACTIONS_SEARCH);
  await waitForLoadingElements(page);
  await page.waitFor(1000);
}

async function getTransactions(page) {
  log.info("Getting transactions.");
  const transactions = await page.evaluate(resultClassName => {
    var trs = Array.from(document.getElementsByClassName(resultClassName));
    return trs.map(tr => {
      var tds = Array.from(tr.children);
      return tds.map(td => {
        return td.innerText.trim();
      });
    });
  }, process.env.TRANSACTIONS_RESULT_CLASS);
  log.info(transactions);

  return transactions;
}

(async () => {
  log.setLevel(log.levels.TRACE);
  const { page, browser } = await startAndNavigateToLoginPage({
    interactiveMode: true
  });
  await performLogin(page);

  await navigateToTransactions(page);

  const allAccounts = await getAllAccounts(page);

  await selectAccount(page, allAccounts[4]);

  await selectTimeRange(page, {
    type: TransactionType.credit,
    from: "13.04.2018",
    to: "14.04.2018"
  });

  let transactions = await getTransactions(page);

  await page.waitFor(5000);
  await performLogout(page);
})().catch(error => {
  log.error(error);
});
