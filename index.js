const puppeteer = require("puppeteer");
const log = require("loglevel");
const path = require("path");
const program = require("commander");
const fs = require("fs-extra");

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

const ExportCsvSelector =
  '#contentHome > div.clearfix.grid_4.col2 > div > h1 > a.noSpinner.evt-csvExport > span';

const TransactionType = Object.freeze({ debit: 0, credit: 1 });

exports = module.exports = this;

async function focusInputField(page, selector) {
  log.debug("Focusing input field:", selector);
  const inputField = await page.$(selector);
  return inputField;
}

async function clearText(page, selector) {
  log.debug("Clearing input field:", selector);
  await page.$eval(selector, input => (input.value = ""));
}

async function typeInInputField(inputField, text, isPassword = false) {
  if (!isPassword) {
    log.debug('Typing text', text);
  } else {
    log.debug('Typing text', '***');
  }
  await inputField.type(text, {
    delay: 10
  });
}

async function waitForNavigation(page) {
  log.debug("Waiting for the navigation to complete.");
  await page.waitForNavigation({
    waitUntil: "networkidle0"
  });
}

async function waitForLoadingElements(page) {
  log.debug("Waiting for loading elements to be removed.");
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
    args: options.args
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
  log.info("Performing Login.");
  log.debug("Select name input field.");
  const nameInputField = await focusInputField(page, LoginNameInput);
  await typeInInputField(nameInputField, process.env.LOGIN_NAME);

  log.debug("Select pin input field.");
  const pinInputField = await focusInputField(page, LoginPinInput);
  await typeInInputField(pinInputField, process.env.LOGIN_PIN, true);
  await page.waitFor(250);

  log.debug("Pressing login button.");
  await page.click(LoginButton);

  await waitForNavigation(page);
}

async function performLogout(page) {
  log.info("Performing Logout.");
  log.debug("Pressing logout button.");
  await page.click(LogoutButton);
}

async function navigateToTransactions(page) {
  log.info("Navigating to Transaction page.");
  page.click(TransactionsMenu);
  await waitForLoadingElements(page);
  await page.waitFor(1000);
}

async function getAllAccounts(page) {
  log.debug("Waiting for account dropdown box to appear.");
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
  log.debug(accounts);

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
  await page.waitFor(1000);

  const fromInputField = await focusInputField(page, fromInputSelector);
  await clearText(page, fromInputSelector);
  await typeInInputField(fromInputField, timeRange.from);

  const toInputField = await focusInputField(page, toInputSelector);
  await clearText(page, toInputSelector);
  await typeInInputField(toInputField, timeRange.to);

  page.click(TransactionsSearchButton);
  await waitForLoadingElements(page);
  await page.waitFor(1000);
}

async function getCsvExport(page, downloadPath) {
  log.info('Exporting CSV');
  const cdp = await page.target().createCDPSession();

  const combinedPath = path.join(__dirname, downloadPath);
  log.debug('Setting downloadPath to ' + combinedPath);
  await cdp.send('Page.setDownloadBehavior', {
    behavior: 'allow',
    downloadPath: combinedPath
  });

  var href = await page.$(ExportCsvSelector);
  await href.click();
  log.debug('Downloading...');

  await page.waitFor(1250);
  await cdp.detach();
  log.debug('Done');
  await page.waitFor(500);
}

async function handleError(page, message, error) {
  log.error(message, error);
  if (page !== undefined && this !== undefined) {
    await createScreenshot(page, path.join(this.options.screenshotDir, 'error.png'));
  }
  process.exit(1);
}

class DkbScraper {
  constructor(options) {
    this.options = options;
  }

  async scrape(accounts) {
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
      await handleError(page, "navigateToTransactions:", error);
    }

    const timeRange = { from: this.options.from, to: this.options.to };
    let allAccounts;
    try {
      allAccounts = await getAllAccounts(page);
    } catch (error) {
      await handleError(page, "getAllAccounts:", error);
    }

    const accountsToScrape =
      accounts[0] === "all"
        ? allAccounts
        : allAccounts.filter(
            allAccount =>
              accounts.filter(
                account => allAccount.name.indexOf(account) !== -1
              ).length > 0
          );

    for (let index = 0; index < accountsToScrape.length; index++) {
      try {
        const account = accountsToScrape[index];
        await selectAccount(page, account);
        await page.waitFor(250);

        await selectTimeRange(page, account, timeRange);

        await getCsvExport(page, this.options.outputFolder);
      } catch (error) {
        await handleError(page, "getTransactionsForAccount:", error);
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
  }
}

log.setLevel('warn');
program.version('0.2.0');

program
  .command("scrape [accounts...]")
  .description(
    "Which account(s)? Either specify an IBAN, a credit card number or type 'all' to query all accounts."
  )
  .option("--from <from>", "From which date?")
  .option("--to <to>", "Until which date?")
  .option("-v, --verbose", "Enables verbose logging.")
  .option("-t, --trace", "Enables trace logging.")
  .option(
    "-s, --screenshotDir <screenshotDir>",
    "Specifies visual logging via screenshots."
  )
  .option(
    "-o, --outputFolder <outputFolder>",
    "Specifies output folder for transactions."
  )
  .option("-i, --interactive-mode", "Shows the browser window.")
  .action(async (accounts, options) => {
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
    log.info("Enabled screenshots to: " + options.screenshotDir);
    fs.ensureDirSync(options.screenshotDir);

    options.outputFolder = options.outputFolder || './exports';

    log.info("Scraping transactions for accounts:", accounts);
    const scraper = new DkbScraper(options);
    await scraper.scrape(accounts).catch(error => {
      log.error("globalScope:", error);
      process.exit(1);
    });
  });

if (!process.argv.slice(2).length) {
  program.help();
}

program.parse(process.argv);
