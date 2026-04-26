/**
 * PaymentGateway interface
 *
 * 每個金流商需實作這些方法。所有方法都是純函式（不碰 DB / Discord）。
 *
 * @typedef {Object} CreateOrderInput
 * @property {string} tradeNo       商家訂單編號
 * @property {number} amount        金額（整數，TWD）
 * @property {string} itemName      品項名稱
 * @property {string} returnUrl     後端 callback (server-to-server)
 * @property {string} clientReturnUrl 使用者付款後瀏覽器導回
 * @property {Date}   expiresAt
 *
 * @typedef {Object} CreateOrderResult
 * @property {'redirect'|'form_post'} mode  redirect=直接給 URL；form_post=要 POST 表單到 actionUrl
 * @property {string} [paymentUrl]          mode=redirect 時的目的地
 * @property {string} [actionUrl]           mode=form_post 時的 form action
 * @property {Object} [formFields]          mode=form_post 時要 POST 的欄位
 *
 * @typedef {Object} CallbackVerifyResult
 * @property {boolean} ok
 * @property {string}  tradeNo
 * @property {'paid'|'failed'} status
 * @property {Object}  raw            原始 callback 資料（驗證後）
 * @property {string}  ackResponse    要回給金流商的 ack 字串
 * @property {string}  [ackContentType] 預設 text/plain
 */
export class PaymentGateway {
  /** @type {string} */
  static provider = 'base';
  /** @type {string} */
  static displayName = 'Base';
  /** 必填憑證欄位 */
  static credentialFields = [];

  constructor({ credentials, sandbox, publicBaseUrl }) {
    this.credentials = credentials;
    this.sandbox = !!sandbox;
    this.publicBaseUrl = publicBaseUrl;
  }

  /**
   * @param {CreateOrderInput} input
   * @returns {Promise<CreateOrderResult>}
   */
  async createOrder(_input) {
    throw new Error('not implemented');
  }

  /**
   * @param {Object} body  callback POST body
   * @returns {Promise<CallbackVerifyResult>}
   */
  async verifyCallback(_body) {
    throw new Error('not implemented');
  }
}
