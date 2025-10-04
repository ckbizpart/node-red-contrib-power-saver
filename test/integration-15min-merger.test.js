const cloneDeep = require("lodash.clonedeep");
const { DateTime } = require("luxon");
const expect = require("chai").expect;
const helper = require("node-red-node-test-helper");
const lowestPrice = require("../src/strategy-lowest-price.js");
const scheduleMerger = require("../src/schedule-merger.js");

helper.init(require.resolve("node-red"));

describe("Integration: 15-minute intervals with schedule merger", function () {
  beforeEach(function (done) {
    helper.startServer(done);
  });

  afterEach(function (done) {
    helper.unload().then(function () {
      helper.stopServer(done);
    });
  });

  it("should merge schedules from two strategy nodes with 15-minute intervals", function (done) {
    const flow = [
      {
        id: "strategy1",
        type: "ps-strategy-lowest-price",
        name: "Night Heating",
        fromTime: "22",
        toTime: "6",
        hoursOn: 2, // 8 intervals in 15-min system
        doNotSplit: false,
        sendCurrentValueWhenRescheduling: true,
        outputIfNoSchedule: false,
        outputOutsidePeriod: false,
        wires: [[], [], ["merger"]],
      },
      {
        id: "strategy2",
        type: "ps-strategy-lowest-price",
        name: "Day Heating", 
        fromTime: "10",
        toTime: "14",
        hoursOn: 1, // 4 intervals in 15-min system
        doNotSplit: false,
        sendCurrentValueWhenRescheduling: true,
        outputIfNoSchedule: false,
        outputOutsidePeriod: false,
        wires: [[], [], ["merger"]],
      },
      {
        id: "merger",
        type: "ps-schedule-merger",
        name: "Combined Schedule",
        logicFunction: "OR",
        schedulingDelay: 100,
        sendCurrentValueWhenRescheduling: true,
        outputIfNoSchedule: false,
        wires: [["output"], [], ["scheduleOut"]],
      },
      { id: "output", type: "helper" },
      { id: "scheduleOut", type: "helper" },
    ];

    helper.load([lowestPrice, scheduleMerger], flow, function () {
      const strategy1 = helper.getNode("strategy1");
      const strategy2 = helper.getNode("strategy2");
      const merger = helper.getNode("merger");
      const scheduleOut = helper.getNode("scheduleOut");

      let mergedScheduleReceived = false;

      scheduleOut.on("input", function (msg) {
        try {
          if (mergedScheduleReceived) return; // Avoid multiple calls
          mergedScheduleReceived = true;

          expect(msg.payload).to.have.property("schedule");
          expect(msg.payload).to.have.property("hours");
          
          // Should have the full day of 15-minute intervals
          expect(msg.payload.hours.length).to.be.greaterThan(90); // Should be around 96 for full day
          
          // Count total "on" intervals - should be sum of both strategies
          const totalOnCount = msg.payload.hours.filter(h => h.onOff === true).length;
          
          console.log(`Merged schedule has ${totalOnCount} intervals on out of ${msg.payload.hours.length} total intervals`);
          
          // Debug: show which intervals are on
          console.log("On intervals:");
          msg.payload.hours.forEach((h, i) => {
            if (h.onOff === true) {
              const dt = DateTime.fromISO(h.start);
              console.log(`  ${dt.toFormat('HH:mm')} (${i})`);
            }
          });
          
          // Should have around 12 intervals on (2 hours + 1 hour = 3 hours * 4 = 12)
          // Allow some flexibility due to overlaps or different cheapest periods
          expect(totalOnCount).to.be.greaterThan(8);
          expect(totalOnCount).to.be.lessThan(16);
          
          done();
        } catch (error) {
          done(error);
        }
      });

      // Generate realistic 15-minute price data for integration test
      const testData = generate15MinuteFullDayData();
      
      // Send to both strategy nodes with slight delay
      strategy1.receive({ payload: testData });
      setTimeout(() => {
        strategy2.receive({ payload: testData });
      }, 50);
    });
  });
});

function generate15MinuteFullDayData() {
  // Generate full day of 15-minute intervals 
  const baseDate = "2024-01-15T00:00:00.000+01:00";
  const baseDateTime = DateTime.fromISO(baseDate);
  
  const priceData = [];
  
  for (let i = 0; i < 96; i++) { // 24 hours * 4 intervals per hour
    const intervalStart = baseDateTime.plus({ minutes: i * 15 });
    const hour = intervalStart.hour;
    
    // Create realistic price curve: cheaper at night, more expensive during peak hours
    let basePrice;
    if (hour >= 22 || hour <= 6) {
      basePrice = 0.15 + Math.random() * 0.10; // Night: 0.15-0.25
    } else if (hour >= 10 && hour <= 14) {
      basePrice = 0.30 + Math.random() * 0.15; // Midday: 0.30-0.45
    } else {
      basePrice = 0.25 + Math.random() * 0.10; // Other times: 0.25-0.35
    }
    
    priceData.push({
      value: Math.round(basePrice * 1000) / 1000,
      start: intervalStart.toISO()
    });
  }

  return {
    source: "Integration15Min",
    priceData,
    time: baseDate
  };
}