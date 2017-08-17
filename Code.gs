function getAccountSummary() {
  // Get account summary to build GA hierarchy
  return Analytics.Management.AccountSummaries.list({
    fields: 'items(id,name,webProperties(id, name, profiles(id, name)))'
  });
}

function getSheet(name) {
  return SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name) || SpreadsheetApp.getActiveSpreadsheet().insertSheet(name);
}

function writeGaHierarchy() {
  var sheet = getSheet('GA Hierarchy'),
      headers = ['Account ID', 'Account Name', 'Property ID', 'Property Name', 'View ID', 'View Name', 'Select for analysis (x/X)'],
      items = getAccountSummary().getItems(),
      final = [];
  var i, j, k;
  // Clear the GA Hierarchy sheet
  sheet.clear();
  // Build hierarchy of accounts, properties, and views
  if (items) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    for (i = 0; i < items.length; i++) {
      if (items[i].webProperties) {
        for (j = 0; j < items[i].webProperties.length; j++) {
          if (items[i].webProperties[j].profiles) {
            for (k = 0; k < items[i].webProperties[j].profiles.length; k++) {
              final.push([
                items[i].id, 
                items[i].name, 
                items[i].webProperties[j].id, 
                items[i].webProperties[j].name, 
                items[i].webProperties[j].profiles[k].id, 
                items[i].webProperties[j].profiles[k].name
              ]);
            }
          }
        }
      }
    }
    sheet.getRange(2, 1, final.length, headers.length - 1).setNumberFormat('@').setValues(final);
  }
}

function isEmpty(sheet) {
  // Check if sheet is empty after the header row
  var firstItem = sheet.getRange(2, 1).getValues();
  return firstItem[0][0] === '';
}

function getCustomDims(accountId, propertyId) {
  // Get list of Custom Dimensions for given account/property
  return Analytics.Management.CustomDimensions.list(accountId, propertyId);
}

function getHitData(dimId, profileId) {
  // Get last 7 days hit data for given Custom Dimension
  return Analytics.Data.Ga.get('ga:' + profileId, '7daysAgo', 'today', 'ga:hits', {dimensions: dimId});
}

function buildGaData(sourceDataValues) {
  // Build the list of Custom Dimensions for selected items
  var data = {'lastItem': 0};
  var idx, dim, customDims, collectedHits, item, accountName, accountId, propertyId, profileId, propertyName, profileName;
  for (idx = 0; idx < sourceDataValues.length; idx++) {
    accountId = sourceDataValues[idx][0];
    accountName = sourceDataValues[idx][1];
    propertyId = sourceDataValues[idx][2];
    propertyName = sourceDataValues[idx][3];
    profileId = sourceDataValues[idx][4];
    profileName = sourceDataValues[idx][5];
    // Show progress popup
    SpreadsheetApp.getActiveSpreadsheet().toast(propertyId + " " + profileName, "Processing " + (idx + 1) + "/" + sourceDataValues.length);
    // Fetch custom dimensions for given property
    customDims = getCustomDims(accountId, propertyId);
    // Build the data structure for each given account/property/profile/dimension
    data['item' + idx] = [];
    data['item' + idx].push([accountName, accountName, accountName, accountName]);
    data['item' + idx].push([propertyName, propertyName, propertyName, propertyName]);
    data['item' + idx].push([propertyId, propertyId, propertyId, propertyId]);
    data['item' + idx].push([profileName, profileName, profileName, profileName]);
    data['item' + idx].push([profileId, profileId, profileId, profileId]);
    data['item' + idx].push(['NAME', 'SCOPE', 'ACTIVE', 'LAST 7 DAYS']);
    // For each Custom dim 1-200, fetch the name, scope, and activity status, or enter blank string if not available
    for (dim = 0; dim < 200; dim++) {
      item = customDims.items[dim];
      if (item) {
        data['item' + idx].push([customDims.items[dim].name, customDims.items[dim].scope, customDims.items[dim].active, '']);
      } else {
        data['item' + idx].push(['', '', '', '']);
      }
    }
    data['lastItem'] = idx + 1;
  }
  return data;
}

function getRowsForAnalysis(sheet) {
  // Return all the rows that have been "selected" from the GA Hierarchy
  var data = [],
      range = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  var i;
  for (i = 0; i < range.length; i++) {
    if (range[i][6] === 'x' || range[i][6] === 'X') {
      data.push(range[i]);
    }
  }
  return data;
}

function buildGaSheet(sheet) {
  // Build the GA Dimensions sheet
  var sourceData = getRowsForAnalysis(sheet),
      gaSheet = getSheet('GA Dimensions'),
      firstCol = [['Account name'], ['Property name'], ['Property ID'], ['View name'], ['View ID'], ['Dimension']];
  var i, columnData;
  if (sourceData.length === 0) {
    throw new Error('No rows selected for analysis.');
  }
  // Clear the GA Dimensions sheet
  gaSheet.clear();
  // Add the first column with identifiers and dimension IDs
  for (i = 1; i <= 200; i++) {
    firstCol.push(['ga:dimension' + i]);
  }
  gaSheet.getRange(1, 1, 206, 1).setValues(firstCol);
  // Fetch the source data based on selected rows
  columnData = buildGaData(sourceData);
  // For each item in the source data, add a set of columns with the dimension data
  for (i = 0; i < columnData['lastItem']; i++) {
    gaSheet.getRange(1, 2 + (i * 4), 206, 4).setNumberFormat('@').setValues(columnData['item' + i]);
  }
  // Freeze the first column to make it easier to navitate
  gaSheet.setFrozenColumns(1)
};

function runValidator() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('GA Hierarchy');
  if (!sheet) {
    throw new Error('You must first create the Google Analytics Hierarchy');
  }
  if (!isEmpty(sheet)) {
    buildGaSheet(sheet);
  }
}

function getGaHits() {
  // Fetch last 7 days data for selected UA-12345-1 property
  var sheet = SpreadsheetApp.getActiveSheet(),
      last7Days = false,
      dimensions = {};
  var i, profileId, selectedCell, selectedColumn, dimensionRange;
  if (sheet.getName() !== 'GA Dimensions') {
    throw new Error('You must be in the GA Dimensions sheet');
  }
  selectedCell = sheet.getActiveCell();
  selectedColumn = selectedCell.getColumn();
  if (selectedColumn === 1 || !/^UA-/.test(sheet.getRange(3, selectedColumn, 1, 1).getValue())) {
    throw new Error('You must select one of the populated data columns!');
  }
  // Allow the user to select any one of the four UA-12345-1 items in the GA Dimensions list
  switch (sheet.getRange(6, selectedColumn).getValue()) {
    case 'NAME':
      selectedColumn += 3;
      break;
    case 'SCOPE':
      selectedColumn += 2;
      break;
    case 'ACTIVE':
      selectedColumn += 1;
      break;
  }
  profileId = sheet.getRange(5, selectedColumn).getValue();
  for (i = 1; i <= 200; i++) {
    dimensions['ga:dimension' + i] = '';
  }
  // Only fetch hit data for dimensions that have active === 'true'
  dimensionRange = sheet.getRange(7, selectedColumn - 1, 200, 1).getValues();
  for (i = 0; i < dimensionRange.length; i++) {
    if (dimensionRange[i][0] === 'true') {
      dimensions['ga:dimension' + (i + 1)] = getHitData('ga:dimension' + (i + 1), profileId)['totalsForAllResults']['ga:hits'];
    }
  }
  for (i = 1; i <= 200; i++) {
    sheet.getRange(7 + (i - 1), selectedColumn, 1, 1).setValue(dimensions['ga:dimension' + i]);
  }
}

function onOpen(e) {
  var menu = SpreadsheetApp.getUi().createAddonMenu();
  menu.addItem('1. Build Google Analytics hierarchy', 'writeGaHierarchy');
  menu.addItem('2. Run validator', 'runValidator');
  menu.addItem('3. Fetch last 7 days data for selected view', 'getGaHits');
  menu.addToUi();
}