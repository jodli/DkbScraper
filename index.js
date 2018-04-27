const puppeteer = require("puppeteer");
const log = require("loglevel");
const path = require("path");
const program = require("commander");

require("dotenv").config();

// URLs
const BaseUrl = "https://www.dkb.de/banking";

// Selectors
const AjaxLoadingSpinner = "body > div.ajax_loading";

const LoginNameInput = "#loginInputSelector";
const LoginPinInput = "#pinInputSelector";
const LoginButton = "#buttonlogin";
const LogoutButton = "#logout";

const TransactionsMenu = "#menu_0\\2e 0\\2e 0-node";

const AccountSelect = "select[id$='_slAllAccounts']";

const TransactionsDebitFrom = "input[id$='_transactionDate']";
const TransactionsDebitTo = "input[id$='_toTransactionDate']";
const TransactionsCreditFrom = "input[id$='_postingDate']";
const TransactionsCreditTo = "input[id$='_toPostingDate']";
const TransactionsSearchButton = "#searchbutton";

const TransactionsResultClass = "mainRow";

const TransactionType = Object.freeze({ debit: 0, credit: 1 });

exports = module.exports = this;

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
  await page.waitForSelector(AjaxLoadingSpinner, {
    hidden: true
  });
}

async function createScreenshot(page, outFile) {
  log.debug("Taking screenshot to file:", outFile);
  await page.screenshot({ path: outFile });
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
  await page.goto(BaseUrl, {
    waitUntil: "domcontentloaded"
  });

  await page.waitFor(1000);
  return { page, browser };
}

async function performLogin(page) {
  log.info("Select name input field.");
  const nameInputField = await focusInputField(page, LoginNameInput);
  await typeInInputField(nameInputField, process.env.LOGIN_NAME);

  log.info("Select pin input field.");
  const pinInputField = await focusInputField(page, LoginPinInput);
  await typeInInputField(pinInputField, process.env.LOGIN_PIN);

  log.info("Pressing login button.");
  await page.click(LoginButton);

  await waitForNavigation(page);
}

async function performLogout(page) {
  log.info("Pressing logout button.");
  await page.click(LogoutButton);
}

async function navigateToTransactions(page) {
  log.info("Navigating to Transaction page.");
  page.click(TransactionsMenu);
  await waitForLoadingElements(page);
  await page.waitFor(1000);
}

async function getAllAccounts(page) {
  log.info("Waiting for account dropdown box appears.");
  await page.waitForSelector(AccountSelect, {
    visible: true
  });

  log.info("Getting all accounts from dropdown box.");
  const accounts = await page.evaluate(
    (selector, transactionType) => {
      const options = Array.from(document.querySelector(selector).options);
      return options.map(option => {
        let account = {
          id: option.value,
          name: option.label
        };
        account.type =
          account.name.indexOf("Kreditkarte") !== -1
            ? transactionType.credit
            : transactionType.debit;
        return account;
      });
    },
    AccountSelect,
    TransactionType
  );
  log.info(accounts);

  return accounts;
}

async function selectAccount(page, account) {
  log.info("Selecting account:", account.name);
  page.select(AccountSelect, account.id);
  await waitForLoadingElements(page);
  await page.waitFor(1000);
}

async function selectTimeRange(page, account, timeRange) {
  log.info(
    "Selecting time range for",
    account.type,
    ":",
    timeRange.from,
    "-",
    timeRange.to
  );

  switch (account.type) {
    case TransactionType.credit:
      fromInputSelector = TransactionsCreditFrom;
      toInputSelector = TransactionsCreditTo;
      break;
    case TransactionType.debit:
      fromInputSelector = TransactionsDebitFrom;
      toInputSelector = TransactionsDebitTo;
      break;
    default:
      reject();
  }

  const fromInputField = await focusInputField(page, fromInputSelector);
  await selectAllText(page);
  await typeInInputField(fromInputField, timeRange.from);

  const toInputField = await focusInputField(page, toInputSelector);
  await selectAllText(page);
  await typeInInputField(toInputField, timeRange.to);

  page.click(TransactionsSearchButton);
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
  }, TransactionsResultClass);
  log.info(transactions);

  return transactions;
}

async function getTransactionsForAccount(page, account, timeRange) {
  await selectAccount(page, account);
  await selectTimeRange(page, account, timeRange);
  await page.waitFor(250);

  let transactions = await getTransactions(page);
}

class DkbScraper {
  constructor(options) {
    this.options = options;
  }

  scrape(accounts) {
    (async accounts => {
      const { page, browser } = await startAndNavigateToLoginPage({
        interactiveMode: this.options.interactiveMode,
        args: ["--no-sandbox", "--disable-setuid-sandbox"]
      });

      await createScreenshot(
        page,
        path.join(this.options.screenshotDir, "before_login.png")
      );
      await performLogin(page);

      try {
        await navigateToTransactions(page);
      } catch (error) {
        log.error("navigateToTransactions:", error);
        await createScreenshot(
          page,
          path.join(this.options.screenshotDir, "error.png")
        );
        process.exit(1);
      }

      const timeRange = { from: this.options.from, to: this.options.to };
      let allAccounts;
      try {
        allAccounts = await getAllAccounts(page);
      } catch (error) {
        log.error("getAllAccounts:", error);
        await createScreenshot(
          page,
          path.join(this.options.screenshotDir, "error.png")
        );
        process.exit(1);
      }

      // TODO: Add function to parse the accounts.
      for (let index = 0; index < allAccounts.length; index++) {
        try {
          await getTransactionsForAccount(page, allAccounts[index], timeRange);
        } catch (error) {
          log.error("getTransactionsForAccount:", error);
          await createScreenshot(
            page,
            path.join(this.options.screenshotDir, "error.png")
          );
          process.exit(1);
        }
      }

      await performLogout(page);
      await createScreenshot(
        page,
        path.join(this.options.screenshotDir, "after_logout.png")
      );

      browser.close();
      log.info("Closed browser.");
      process.exit(0);
    })().catch(error => {
      log.error("globalScope:", error);
      process.exit(1);
    });
  }
}

log.setLevel("warn");
program.version("0.1.0");

program
  .command("scrape [accounts...]")
  .description(
    "Which account(s)? Either specify a IBAN or the credit card number in the following format: "
  )
  .option("--from <from>", "From which date?")
  .option("--to <to>", "Until which date?")
  .option("-v, --verbose", "Enables verbose logging.")
  .option("-t, --trace", "Enables trace logging.")
  .option(
    "-s, --screenshotDir <screenshotDir>",
    "Specifies visual logging via screenshots."
  )
  .option("-i, --interactive-mode", "Shows the browser window.")
  .action((accounts, options) => {
    if (accounts.length === 0 || !options.from || !options.to) {
      program.help();
    }
    if (options.verbose) {
      log.setLevel("info");
      log.info("Enabled verbose logging.");
    }
    if (options.trace) {
      log.enableAll();
      log.trace("Enabled trace logging.");
    }
    options.interactiveMode = options.interactiveMode || false;
    if (options.interactiveMode) {
      log.info("Running the browser in interactive mode.");
    }
    options.screenshotDir = options.screenshotDir || "./screenshots";
    if (options.screenshotDir) {
      log.info("Enabled screenshots to: " + options.screenshotDir);
    }

    log.info("Scraping transactions for accounts:", accounts);
    const scraper = new DkbScraper(options);
    scraper.scrape(accounts);
  });

program.parse(process.argv);
