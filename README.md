# DkbScraper

This is my take on automating the scraping of data from the DKB (Deutsche Kreditbank) page.

It supports extraction of Debit and Credit accounts.

## Requirements

- Node v7.6.0 or greater

## How does it work?

It will log-in with the supplied data in the .env file (see sample.env file for needed data).
It will then navigate to the transaction page and enter the data needed to get the export.

That data is:

- Bank Account Number / VISA Card Number
- From Date
- To Date

After that it clicks on the "CSV Export" Button and saves the file in the specified output directory.

## Usage

1. Add correct data to the .env file
2. Install dependencies (npm install)
3. Supply desired inputs

### Example

`node index.js scrape 01.01.2019 31.01.2019 DE123456 7890`

This scrapes all transactions on the bank account containing the number "DE123456" and the VISA card containing the number "7890" that occured between the 01.01.2019 and the 31.01.2019.

For more information call the script with the `-h` flag to display the help file.
