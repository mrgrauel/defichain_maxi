import { CTransaction } from '@defichain/jellyfish-transaction/dist'
import { AddressToken } from '@defichain/whale-api-client/dist/api/address'
import { BigNumber } from '@defichain/jellyfish-api-core'
import { IStore } from '../utils/store'
import { Telegram } from '../utils/telegram'
import { WalletSetup } from '../utils/wallet-setup'
import { CommonProgram } from './common-program'

export class SendProgramm extends CommonProgram {
  readonly toAddress: string
  readonly threshold: number

  constructor(store: IStore, walletSetup: WalletSetup) {
    super(store, walletSetup)
    this.toAddress = this.settings.toAddress
    this.threshold = this.settings.sendThreshold ?? 1
  }

  async doChecks(telegram: Telegram): Promise<boolean> {
    if (!this.doValidationChecks(telegram, false)) {
      return false
    }

    const utxoBalance = await this.getUTXOBalance()
    if (utxoBalance.lte(1e-4)) {
      //1 tx is roughly 2e-6 fee, one action mainly 3 tx -> 6e-6 fee. we want at least 10 actions safety -> below 1e-4 we warn
      const message =
        'your UTXO balance is running low in ' +
        this.settings.address +
        ', only ' +
        utxoBalance.toFixed(5) +
        ' DFI left. Please replenish to prevent any errors'
      await telegram.send(message)
      console.warn(message)
    }

    return true
  }

  async doSend(balances: Map<String, AddressToken>, telegram: Telegram): Promise<boolean> {
    if (!this.settings.toAddress) {
      return false
    }
    let txsToSign: CTransaction[] = []
    const utxoBalance = await this.getUTXOBalance()
    const tokenBalance = balances.get('DFI')

    const amountFromBalance = new BigNumber(tokenBalance?.amount ?? '0')
    const fromUtxos = utxoBalance.gt(1) ? utxoBalance.minus(1) : new BigNumber(0)
    let amountToUse = fromUtxos.plus(amountFromBalance)
    const tx = await this.sendDFIToAccount(amountToUse, this.toAddress)
    txsToSign.push(tx)

    if (!this.canSign()) {
      await this.sendTxDataToTelegram(txsToSign, telegram)
      txsToSign = []
    }

    if (!(await this.waitForTx(tx.txId))) {
      await telegram.send('ERROR: sending of DFI failed')
      console.error('sending DFI failed')
      return false
    }

    await telegram.send('send ' + amountToUse.toFixed(4) + '@DFI' + ' to: ' + this.toAddress)

    return true
  }
}
