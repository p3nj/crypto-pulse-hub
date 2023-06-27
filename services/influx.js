const { Agent } = require('http');
const { InfluxDB, Point, DEFAULT_WriteOptions} = require('@influxdata/influxdb-client');
const { influxUrl, influxToken, influxOrg, influxBucket } = require('../env');
const logger = require("../utils/logger");
const {error} = require("../utils/logger");

const flushBatchSize = DEFAULT_WriteOptions.batchSize;

// advanced write options
const writeOptions = {
	/* the maximum points/lines to send in a single batch to InfluxDB server */
	batchSize: flushBatchSize + 1, // don't let automatically flush data
	/* default tags to add to every point */
	/* maximum time in millis to keep points in an unflushed batch, 0 means don't periodically flush */
	flushInterval: 15_000,
	/* maximum size of the retry buffer - it contains items that could not be sent for the first time */
	maxBufferLines: 30_000,
	/* the count of internally-scheduled retries upon write failure, the delays between write attempts follow an exponential backoff strategy if there is no Retry-After HTTP header */
	maxRetries: 0, // do not retry writes
	// ... there are more write options that can be customized, see
	// https://influxdata.github.io/influxdb-client-js/influxdb-client.writeoptions.html and
	// https://influxdata.github.io/influxdb-client-js/influxdb-client.writeretryoptions.html
}

const agent = new Agent({
	keepAlive: true, // Reuse existing connection
  // keepALiveMsecs: 30 * 1000, // 30 seconds keep alive
});

// Create a new InfluxDB client instance
const influx = new InfluxDB({
	url: influxUrl,
	token: influxToken,
	transportOptions: { agent },
});

const writeApi = influx.getWriteApi(influxOrg, influxBucket, 'ns');

const queryApi = influx.getQueryApi(influxOrg);

process.on('exit', () => agent.destroy());


/**
 * Writes data points to InfluxDB.
 * @param {Point[]} points - The data points to write.
 * @returns {Promise<void>} - A promise that resolves when the write is complete.
 */
async function writeData(points) {
	try{
    writeApi.writePoints(points);
		return writeApi.flush();
	} catch (err) {
		logger.error(`Error writing data points to InfluxDB: ${err.message}`);
		throw err;
	}
}

/**
 * Queries data from InfluxDB using the specified query.
 * @param {string} query - The InfluxQL query to execute.
 * @returns {Promise<object[]>} - A promise that resolves with an array of query results.
 */
function queryData(query) {
	return queryApi.collectRows(query);
}

/**
 * Queries the latest data point for the specified metric from InfluxDB.
 * @param {string} metric - The metric to query the latest data point for.
 * @returns {Promise<object>} - A promise that resolves with an object containing the timestamp, symbol, and interval of the latest data point.
 */
function queryLatestDataPoint(metric) {
	const query = `
    from(bucket: "${influxBucket}")
      |> range(start: -1h)
      |> filter(fn: (r) => r._measurement == "${metric}")
      |> last()
  `;

	return queryData(query)
		.then((result) => {
			const dataPoint = result[0];
			return {
				timestamp: new Date(dataPoint._time).getTime(),
				symbol: dataPoint.symbol,
				interval: dataPoint.interval,
			};
		})
		.catch((err) => {
			error(`Error querying latest data point for metric ${metric}: ${err.message}`);
			throw err;
		});
}

module.exports = {
	writeData,
	queryData,
	queryLatestDataPoint,
};