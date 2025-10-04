const cloneDeep = require("lodash.clonedeep");
const { DateTime } = require("luxon");
const expect = require("chai").expect;
const helper = require("node-red-node-test-helper");
const lowestPrice = require("../src/strategy-lowest-price.js");

helper.init(require.resolve("node-red"));

describe("ps-strategy-lowest-price node with 15-minute intervals", function () {
  beforeEach(function (done) {
    helper.startServer(done);
  });

  afterEach(function (done) {
    helper.unload().then(function () {
      helper.stopServer(done);
    });
  });

  it("should handle 15-minute interval data correctly", function (done) {
    const flow = [
      {
        id: "n1",
        type: "ps-strategy-lowest-price",
        name: "test name",
        fromTime: "10",
        toTime: "12",
        hoursOn: 2,
        doNotSplit: false,
        sendCurrentValueWhenRescheduling: true,
        outputIfNoSchedule: false,
        outputOutsidePeriod: false,
        wires: [["n3"], ["n4"], ["n2"]],
      },
      { id: "n2", type: "helper" },
      { id: "n3", type: "helper" },
      { id: "n4", type: "helper" },
    ];

    helper.load(lowestPrice, flow, function () {
      const n1 = helper.getNode("n1");
      const n2 = helper.getNode("n2");

      n2.on("input", function (msg) {
        try {
          // Check that we get a schedule
          expect(msg.payload).to.have.property("schedule");
          expect(msg.payload).to.have.property("hours");
          
          // Should have 20 intervals (5 hours of 15-minute intervals)
          expect(msg.payload.hours).to.have.length(20);
          
          // Count how many intervals are "on"
          const onCount = msg.payload.hours.filter(h => h.onOff === true).length;
          
          // Should have exactly 8 intervals "on" (2 hours * 4 intervals per hour)
          expect(onCount).to.equal(8);
          
          // Verify that the "on" intervals are in the correct time range (10:00-11:45)
          const onHours = msg.payload.hours.filter(h => h.onOff === true);
          onHours.forEach(h => {
            const dt = DateTime.fromISO(h.start);
            const hour = dt.hour;
            expect(hour).to.be.oneOf([10, 11]);
          });
          
          done();
        } catch (error) {
          done(error);
        }
      });

      // Generate 15-minute test data
      const payload = generate15MinuteTestData();
      n1.receive({ payload });
    });
  });

  it("should work with 15-minute intervals within same day", function (done) {
    const flow = [
      {
        id: "n1",
        type: "ps-strategy-lowest-price", 
        name: "test name",
        fromTime: "14",
        toTime: "16", 
        hoursOn: 1,
        doNotSplit: false,
        sendCurrentValueWhenRescheduling: true,
        outputIfNoSchedule: false,
        outputOutsidePeriod: false,
        wires: [["n3"], ["n4"], ["n2"]],
      },
      { id: "n2", type: "helper" },
      { id: "n3", type: "helper" },
      { id: "n4", type: "helper" },
    ];

    helper.load(lowestPrice, flow, function () {
      const n1 = helper.getNode("n1");
      const n2 = helper.getNode("n2");

      n2.on("input", function (msg) {
        try {
          expect(msg.payload).to.have.property("schedule");
          expect(msg.payload).to.have.property("hours");
          
          // Count how many intervals are "on"
          const onCount = msg.payload.hours.filter(h => h.onOff === true).length;
          
          // Should have exactly 4 intervals "on" (1 hour * 4 intervals per hour) 
          expect(onCount).to.equal(4);
          
          // Verify that the "on" intervals are in the correct time range (14:00-15:45)
          const onHours = msg.payload.hours.filter(h => h.onOff === true);
          onHours.forEach(h => {
            const dt = DateTime.fromISO(h.start);
            const hour = dt.hour;
            expect(hour).to.be.oneOf([14, 15]);
          });
          
          done();
        } catch (error) {
          done(error);
        }
      });

      // Generate 15-minute test data that stays within same day
      const payload = generate15MinuteTestDataSameDay();
      n1.receive({ payload });
    });
  });
});

function generate15MinuteTestData() {
  // Generate data from 09:00 to 14:00 (5 hours = 20 intervals)
  const baseDate = "2021-10-11T09:00:00.000+02:00";
  const baseDateTime = DateTime.fromISO(baseDate);
  
  const priceData = [];
  const prices = [0.5, 0.4, 0.3, 0.2, 0.6, 0.7, 0.1, 0.8, 0.9, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95, 0.05, 0.95];
  
  for (let i = 0; i < 20; i++) {
    const intervalStart = baseDateTime.plus({ minutes: i * 15 });
    priceData.push({
      value: prices[i],
      start: intervalStart.toISO()
    });
  }

  return {
    source: "Test15Min",
    priceData,
    time: baseDateTime.plus({ minutes: 4 * 15 }).toISO() // 10:00
  };
}

function generate15MinuteTestDataSameDay() {
  // Generate data from 12:00 to 18:00 (6 hours = 24 intervals)
  const baseDate = "2021-10-11T12:00:00.000+02:00";
  const baseDateTime = DateTime.fromISO(baseDate);
  
  const priceData = [];
  const prices = [0.5, 0.4, 0.3, 0.2, 0.6, 0.7, 0.1, 0.8, 0.9, 0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85, 0.95, 0.05, 0.95, 0.12, 0.23, 0.34, 0.45];
  
  for (let i = 0; i < 24; i++) {
    const intervalStart = baseDateTime.plus({ minutes: i * 15 });
    priceData.push({
      value: prices[i],
      start: intervalStart.toISO()
    });
  }

  return {
    source: "Test15MinSameDay", 
    priceData,
    time: baseDateTime.plus({ minutes: 8 * 15 }).toISO() // 14:00 - start of period
  };
}