const { DateTime } = require("luxon");
const { booleanConfig, calcNullSavings, fixOutputValues, saveOriginalConfig } = require("./utils");
const { getBestContinuous, getBestX } = require("./strategy-lowest-price-functions");
const { strategyOnInput } = require("./strategy-functions");

module.exports = function (RED) {
  function StrategyLowestPriceNode(config) {
    RED.nodes.createNode(this, config);
    const node = this;
    node.status({});

    const validConfig = {
      fromTime: config.fromTime,
      toTime: config.toTime,
      hoursOn: parseInt(config.hoursOn),
      maxPrice: config.maxPrice == null || config.maxPrice == "" ? null : parseFloat(config.maxPrice),
      doNotSplit: booleanConfig(config.doNotSplit),
      sendCurrentValueWhenRescheduling: booleanConfig(config.sendCurrentValueWhenRescheduling),
      outputIfNoSchedule: booleanConfig(config.outputIfNoSchedule),
      outputOutsidePeriod: booleanConfig(config.outputOutsidePeriod),
      outputValueForOn: config.outputValueForOn || true,
      outputValueForOff: config.outputValueForOff || false,
      outputValueForOntype: config.outputValueForOntype || "bool",
      outputValueForOfftype: config.outputValueForOfftype || "bool",
      override: "auto",
      contextStorage: config.contextStorage || "default",
    };

    fixOutputValues(validConfig);
    saveOriginalConfig(node, validConfig);

    node.on("close", function () {
      clearTimeout(node.schedulingTimeout);
    });

    node.on("input", function (msg) {
      strategyOnInput(node, msg, doPlanning, calcNullSavings);
    });
  }
  RED.nodes.registerType("ps-strategy-lowest-price", StrategyLowestPriceNode);
};

function doPlanning(node, priceData) {
  const values = priceData.map((pd) => pd.value);
  const startTimes = priceData.map((pd) => pd.start);

  const from = parseInt(node.fromTime);
  const to = parseInt(node.toTime);
  const periodStatus = [];
  const startIndexes = [];
  const endIndexes = [];
  let currentStatus = from < (to === 0 && to !== from ? 24 : to) ? "Outside" : "StartMissing";
  let hour;
  let currentHourStart = null;
  
  startTimes.forEach((st, i) => {
    hour = DateTime.fromISO(st).hour;
    
    // Check if we're starting a new hour and need to handle transitions
    if (currentHourStart !== hour) {
      // Handle end of period when we reach the "to" hour
      if (currentHourStart === to && to === from && currentStatus === "Inside") {
        endIndexes.push(i - 1);
      }
      if (currentHourStart === to && to !== from && i > 0) {
        if (currentStatus !== "StartMissing") {
          endIndexes.push(i - 1);
        }
        currentStatus = "Outside";
      }
      
      // Handle start of period when we reach the "from" hour
      if (hour === from) {
        currentStatus = "Inside";
        startIndexes.push(i);
      }
      
      currentHourStart = hour;
    }
    
    periodStatus[i] = currentStatus;
  });
  
  if (currentStatus === "Inside" && hour !== (to === 0 ? 23 : to - 1)) {
    // Last period incomplete
    let i = periodStatus.length - 1;
    do {
      periodStatus[i] = "EndMissing";
      hour = DateTime.fromISO(startTimes[i]).hour;
      i--;
    } while (i >= 0 && periodStatus[i] === "Inside" && hour !== from);
    startIndexes.splice(startIndexes.length - 1, 1);
  }
  if (hour === (to === 0 ? 23 : to - 1)) {
    endIndexes.push(startTimes.length - 1);
  }

  const onOff = [];

  // Set onOff for hours that will not be planned
  periodStatus.forEach((s, i) => {
    onOff[i] =
      s === "Outside"
        ? node.outputOutsidePeriod
        : s === "StartMissing" || s === "EndMissing"
        ? node.outputIfNoSchedule
        : null;
  });

  startIndexes.forEach((s, i) => {
    makePlan(node, values, onOff, s, endIndexes[i], priceData);
  });

  return onOff;
}

function makePlan(node, values, onOff, fromIndex, toIndex, priceData) {
  const valuesInPeriod = values.slice(fromIndex, toIndex + 1);
  
  // Detect the interval size by checking time differences between consecutive entries
  let intervalsPerHour = 1; // Default to hourly
  if (priceData && priceData.length > 1) {
    const firstTime = DateTime.fromISO(priceData[0].start);
    const secondTime = DateTime.fromISO(priceData[1].start);
    const minutesDiff = secondTime.diff(firstTime, 'minutes').minutes;
    if (minutesDiff === 15) {
      intervalsPerHour = 4; // 15-minute intervals
    } else if (minutesDiff === 30) {
      intervalsPerHour = 2; // 30-minute intervals
    }
    // else keep intervalsPerHour = 1 for hourly data
  }
  
  const intervalsOn = node.hoursOn * intervalsPerHour;
  const res = node.doNotSplit
    ? getBestContinuous(valuesInPeriod, intervalsOn)
    : getBestX(valuesInPeriod, intervalsOn);
  const sumPriceOn = res.reduce((p, v, i) => {
    return p + (v ? valuesInPeriod[i] : 0);
  }, 0);
  const average = sumPriceOn / intervalsOn;
  res.forEach((v, i) => {
    onOff[fromIndex + i] =
      node.maxPrice == null
        ? v
        : node.doNotSplit
        ? v && average <= node.maxPrice
        : v && valuesInPeriod[i] <= node.maxPrice;
  });
  return onOff;
}
