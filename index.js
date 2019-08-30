'use strict'

const debug = require('debug')('rrutils')

/**
 * Various useful utilities.
 *
 * Provided utilities are:
 *
 * - **_** from lodash
 * - **axios** from axios
 * - **jsonwebtoken** aliased to **jwt** from jsonwebtoken
 * - **stringify** from json-stringify-safe
 * - **fs** from node
 * - **path** from node
 * - **uuid** from uuid/v1
 * - **Joi** from @hapi/joi
 * - **loadConfig** loads everything from ./config
 * - **xml2js** from xml2js
 * - **parseXML** from xml2js
 * - **parseXMLAsync** promisified version of xml2js.
 * - **wait** async/await function that waits for N milliseconds
 * - **log** from logger.js / winston
 * - **DEBUG** from process.env
 * - ...as well as other various **utility functions** defined below.
 *
 * The returned module contains refs to all these utility functions/modules as well as mixing in
 * everything from Node's **util** module, e.g.
 *
 * ```
 *   const { _, promisify, fs } = require('utils')
 *     // => lodash as "_", util.promisify as "promisify", and node's fs as "fs".
 * ```
 *
 *
 * @module
 *
 * @see {@link https://nodejs.org/api/util.html|util}
 * @see {@link https://nodejs.org/api/path.html|path}
 * @see {@link https://nodejs.org/api/fs.html|fs}
 * @see {@link https://www.npmjs.com/package/axios|axios}
 * @see {@link https://www.npmjs.com/package/jsonwebtoken|jsonwebtoken}
 * @see {@link https://lodash.com/|lodash}
 * @see {@link https://www.npmjs.com/package/uuid|uuid}
 * @see {@link https://www.npmjs.com/package/json-stringify-safe|json-stringify-safe}
 * @see {@link https://www.npmjs.com/package/@hapi/joi|@hapi/joi}
 * @see {@link https://www.npmjs.com/package/xml2js|xml2js}
 * @see {@link https://www.npmjs.com/package/winston|winston}
 */

const path = require('path')
const fs = require('fs')
const util = require('util')
const glob = require('glob')

const _ = require('lodash')
const axios = require('axios')
const jsonwebtoken = require('jsonwebtoken')
const uuid = require('uuid/v1')
const stringify = require('json-stringify-safe')
const Joi = require('@hapi/joi')
const Mustache = require('mustache')
const winston = require('winston')

const xml2js = require('xml2js')
const parseXML = xml2js.parseString
const parseXMLAsync = util.promisify(parseXML)

/**
 * Add useful functions to lodash.
 */
_.mixin({
  /**
   * Returns true if the arg is a String with length > 0.
   *
   * @param  {String}  str
   * @return {Boolean}
   */
  isNonEmptyString: (str) => _.isString(str) && !_.isEmpty(str),

  /**
   * Returns true if the arg is an Object with at least one property.
   *
   * @param  {String}  obj
   * @return {Boolean}
   */
  isNonEmptyObject: (obj) => _.isPlainObject(obj) && !_.isEmpty(obj),

  /**
   * Returns true if the arg is an Array with at least one member.
   *
   * @param  {String}  obj
   * @return {Boolean}
   */
  isNonEmptyArray: (ary) => _.isArray(ary) && !_.isEmpty(ary),

  /**
   * Return true if n is an even integer.
   * @param  {Integer}  n
   * @return {Boolean}
   */
  isEven: (n) => n % 2 === 0,

  /**
   * Safely converts an object or a string into a new object.
   *
   * @param  {Object|String} arg
   * @return {Object}
   */
  safeJSONToObject: (arg) => {
    if (!_.isString(arg)) {
      arg = stringify(arg)
    }
    return JSON.parse(arg)
  },

  /**
   * Returns true if the event has a 'verbose' in queryStringParameters.
   *
   * @param  {AWSEvent} event
   * @return {Boolean}
   */
  eventIsVerbose: (event) => _.isString(_.get(event, 'queryStringParameters.verbose', null)),

  /**
   * Returns a string from a number with expanded exponent.
   *
   * @param  {Number} n
   * @return {String}
   *
   * @example
   *
   * _.toStringWithoutExponent(1.7976931348623157e+308) => '179769313486231570000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000'
   */
  toStringWithoutExponent: (n) => {
    var data = String(n).split(/[eE]/)
    if (data.length === 1) return data[0]

    let z = ''
    const sign = n < 0 ? '-' : ''
    const str = data[0].replace('.', '')
    let mag = Number(data[1]) + 1

    if (mag < 0) {
      z = sign + '0.'
      while (mag++) z += '0'
      return z + str.replace(/^-/, '')
    }
    mag -= str.length
    while (mag--) z += '0'
    return str + z
  }
})

const trace = (output) => {
  try { throw new Error() } catch (err) {
    output(`--trace: ${err.stack}`)
  }
}

const xml2obj = async (xml) => {
  return parseXMLAsync(xml, { explicitArray: false, mergeAttrs: true })
}

const obj2xml = (obj) => {
  if (_.isNonEmptyString(obj)) {
    log.warn(`util.obj2xml converting to obj`, { obj })
    obj = JSON.parse(obj)
  }
  if (!(_.isPlainObject(obj) && !_.isEmpty(obj))) {
    throw new Error(`utils.obj2xml requires an object`)
  }
  log.debug(`util.obj2xml building result`, { obj })
  const builder = new xml2js.Builder({ explicitArray: false })
  try {
    return builder.buildObject(obj)
  } catch (err) {
    log.error(`util.obj2xml failed to build XML`, { err: err.toString(), obj })
  }
}

/**
 * @type {Boolean}
 */
const DEBUG = !!_.get(process, 'env.DEBUG')

/**
 * Create config object from the union of all .json or .js config files in dirpath keyed by their filenames
 * and package.json keyed at pkg.
 *
 * @param {String} [dirpath=../config] path to directory of config files
 * @return {Object}
 *
 * @throws {Error}
 */
const loadConfig = (dirpath = '../config') => {
  if (_.isNonEmptyObject(loadConfig.result)) {
    return loadConfig.result
  }

  debug('loading config')

  const result = {
    pkg: require(path.resolve(__dirname, '../package.json')),
    env: _.get(process, 'env')
  }

  const files = fs.readdirSync(path.resolve(__dirname, dirpath))
  debug(`read ${files.length} config files: ${files}`)

  _.forEach(files, file => {
    file = path.basename(file)
    if (!(_.isNonEmptyString(file) && file.match(/\.(?:js|json)$/))) {
      debug(`ignoring bad config file: ${file}`)
      return
    }

    const filePath = path.resolve(__dirname, dirpath, file)
    const key = file.replace(/\..+$/, '')
    try {
      debug(`loading config from ${filePath}`)
      result[key] = require(filePath)
    } catch (err) {
      throw new Error(`failed to load config from ${filePath}: ${err}`)
    }
  })

  loadConfig.result = result // memoized

  return result
}

const makeLogger = (service) => {
  const { createLogger, format, transports } = winston
  const LOG_LEVEL = DEBUG ? 'debug' : _.get(process, 'env.LOG_LEVEL', 'info')
  createLogger({
    level: LOG_LEVEL,
    defaultMeta: { service },
    format: format.combine(format.splat(), format.simple()),
    transports: [
      new transports.Console()
    ]
  })
}

/**
 * Create an ISO8601 timestamp string for the current time and date.
 *
 * @return {String}
 */
const getTimestamp = () => (new Date()).toISOString()

/**
 * Create a short numeric timestamp for the current time and date.
 *
 * @return {Number}
 */
const getShortTimestamp = () => Date.now()

/**
 * Get a random monetary value between 4.0 and 14.00
 *
 * @return {Number}
 */
const getRandomMoney = () => (4.0 + (Math.random() * 10)).toFixed(2)

/**
 * Get a random integer less than max.
 *
 * @param {Number} [max=10]
 * @return {Number}
 */
const getRandomInt = (max = 10) => Math.floor(Math.random() * Math.floor(max))

/**
 * Get a date duration days in the future.
 *
 * @param {Number} [duration=7]
 * @return {Number}
 */
const getFutureDate = (duration = getRandomInt(7)) => {
  const today = new Date()
  const result = new Date(today.setDate(today.getDate() + duration))
  debug(`getFutureDate returns ${result}`)
  return result
}

/**
 * Wait for a time.
 *
 * @param  {Integer}  ms - milliseconds to wait
 * @return {Promise}
 */
const wait = async ms => {
  log.debug(`waiting ${ms} milliseconds`)
  return new Promise(resolve => setTimeout(resolve, ms || 1000))
}

module.exports = _.merge(util, {
  _,
  stringify,
  fs,
  path,
  uuid,
  Joi,
  Mustache,
  axios,
  jsonwebtoken,
  jwt: jsonwebtoken,
  winston,
  loadConfig,
  makeLogger,
  getTimestamp,
  getShortTimestamp,
  getRandomInt,
  getRandomMoney,
  getFutureDate,
  xml2js,
  parseXML,
  parseXMLAsync,
  xml2obj,
  obj2xml,
  trace,
  wait,
  DEBUG
})

/**
 * The result returned from a Lambda handler.
 * @typedef {object} LambdaHandlerResult
 * @property {number} statusCode
 * @property {string} body
 */

/**
 * Rules Engine Rule.
 * @typedef {Object} Rule
 * @property {String} name
 * @property {String} message
 * @property {Function} condition
 * @property {Function} consequence
 * @property {Boolean} active
 * @property {Number} priority
 */
