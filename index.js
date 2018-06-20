const puppeteer = require("puppeteer");
const log = require("loglevel");
const path = require("path");
const program = require("commander");
const fs = require("fs-extra");
const listr = require("listr");

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

const SaldoSpan =
  "div.clearfix.module.accountBalance > span.floatRight > strong > span";

const TransactionsDebitFrom = "input[id$='_transactionDate']";
const TransactionsDebitTo = "input[id$='_toTransactionDate']";
const TransactionsCreditFrom = "input[id$='_postingDate']";
const TransactionsCreditTo = "input[id$='_toPostingDate']";
const TransactionsSearchButton = "#searchbutton";

const TransactionsResultClass = "mainRow";

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

async function typeInInputField(inputField, text) {
  log.debug("Typing text", text);
  await inputField.type(text, {
    delay: 10
  });
}

async function getInnerText(page, selector) {
  const text = page.$eval(selector, element => element.innerText);
  return text;
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
  await typeInInputField(pinInputField, process.env.LOGIN_PIN);

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
  log.debug(transactions);

  return transactions;
}

async function getSaldoForAccount(page) {
  log.info("Getting saldo for account.");
  return await getInnerText(page, SaldoSpan);
}

async function getTransactionsForAccount(page, account, timeRange) {
  log.info("Getting transactions for account:", account);

  await selectTimeRange(page, account, timeRange);
  await page.waitFor(250);

  return await getTransactions(page);
}

function exportToFile(outFolder, output) {
  const combinedPath = path.join(
    outFolder,
    output.account.name.replace(/[/\|&;$%@"<>()+,* ]/g, "")
  );

  log.info("Writing data:", output, " to folder:", combinedPath);

  fs.ensureDirSync(combinedPath);
  fs.writeFileSync(
    path.join(
      combinedPath,
      output.timeRange.from + "_" + output.timeRange.to + ".json"
    ),
    JSON.stringify(output),
    "utf8",
    err => {
      if (err) {
        log.error("Could not write file.", err);
        throw err;
      }
      log.debug("Done writing transactions to file.");
    }
  );
}

async function handleError(page, message, error) {
  log.error(message, error);
  await createScreenshot(
    page,
    path.join(this.options.screenshotDir, "error.png")
  );
  Promise.reject();
}

class DkbScraper {
  constructor(options, accounts) {
    this.options = options;
    this.accounts = accounts;
  }

  async scrape() {
    const tasks = new listr([
      {
        title: "Starting the browser and navigating to the login page",
        task: async () => {
          this.puppeteer = await startAndNavigateToLoginPage({
            interactiveMode: this.options.interactiveMode,
            args: ["--no-sandbox", "--disable-setuid-sandbox"]
          });
        }
      },
      {
        title: "Logging in and navigating to transactions page",
        task: async () => {
          await createScreenshot(
            this.puppeteer.page,
            path.join(this.options.screenshotDir, "before_login.png")
          );
          await performLogin(this.puppeteer.page);
          try {
            await navigateToTransactions(this.puppeteer.page);
          } catch (error) {
            await handleError(
              this.puppeteer.page,
              "navigateToTransactions:",
              error
            );
          }
        }
      },
      {
        title: "Preparing the scrape",
        task: async ctx => {
          try {
            this.allAccounts = await getAllAccounts(this.puppeteer.page);
          } catch (error) {
            await handleError(this.puppeteer.page, "getAllAccounts:", error);
          }
          ctx.accountsToScrape =
            this.accounts[0] === "all"
              ? this.allAccounts
              : this.allAccounts.filter(
                  allAccount =>
                    this.accounts.filter(
                      account => allAccount.name.indexOf(account) !== -1
                    ).length > 0
                );
          ctx.timeRange = { from: this.options.from, to: this.options.to };
        }
      },
      {
        title: "Scraping...",
        task: async ctx => {
          for (let index = 0; index < ctx.accountsToScrape.length; index++) {
            const subTasks = new listr([
              {
                title: "Selecting account and its saldo",
                task: async innerCtx => {
                  try {
                    innerCtx.account = ctx.accountsToScrape[index];
                    await selectAccount(this.puppeteer.page, innerCtx.account);

                    await this.puppeteer.page.waitFor(250);
                    innerCtx.saldo = await getSaldoForAccount(
                      this.puppeteer.page
                    );
                  } catch (error) {
                    await handleError(
                      this.puppeteer.page,
                      "getTransactionsForAccount:",
                      error
                    );
                  }
                }
              },
              {
                title: "Getting transactions for the account",
                task: async innerCtx => {
                  try {
                    innerCtx.transactions = await getTransactionsForAccount(
                      this.puppeteer.page,
                      innerCtx.account,
                      ctx.timeRange
                    );
                  } catch (error) {
                    await handleError(
                      this.puppeteer.page,
                      "getTransactionsForAccount:",
                      error
                    );
                  }
                }
              },
              {
                title: "Exporting everything to a file",
                task: async innerCtx => {
                  try {
                    exportToFile(this.options.outputFolder, {
                      account: innerCtx.account,
                      saldo: innerCtx.saldo,
                      timeRange: ctx.timeRange,
                      transactions: innerCtx.transactions
                    });
                  } catch (error) {
                    await handleError(
                      this.puppeteer.page,
                      "getTransactionsForAccount:",
                      error
                    );
                  }
                }
              }
            ]);
            await subTasks.run();
          }
        }
      },
      {
        title: "Logging out",
        task: async () => {
          await performLogout(this.puppeteer.page);
          await createScreenshot(
            this.puppeteer.page,
            path.join(this.options.screenshotDir, "after_logout.png")
          );
        }
      },
      {
        title: "Cleaning up",
        task: async () => {
          this.puppeteer.browser.close();
          log.info("Closed browser.");
          Promise.resolve();
        }
      }
    ]);
    return tasks.run();
  }
}

log.setLevel("warn");
program.version("0.1.0");

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

    options.outputFolder = options.outputFolder || "./output";
    log.info("Enabled exports to: " + options.outputFolder);

    log.info("Scraping transactions for accounts:", accounts);
    const scraper = new DkbScraper(options, accounts);
    await scraper.scrape().catch(error => {
      log.error("globalScope:", error);
      process.exit(1);
    });
  });

if (!process.argv.slice(2).length) {
  program.help();
}

program.parse(process.argv);
