import { BigNumber } from '@defichain/jellyfish-api-core'
import { CTransaction } from '@defichain/jellyfish-transaction/dist'
import { IStore } from '../utils/store'
import { Telegram } from '../utils/telegram'
import { WalletSetup } from '../utils/wallet-setup'
import { CommonProgram } from './common-program'
import { Prevout } from '@defichain/jellyfish-transaction-builder'

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

  async doSend(telegram: Telegram): Promise<boolean> {
    if (!this.settings.toAddress) {
      return false
    }
    const utxoBalance = await this.getUTXOBalance()
    console.log('utxo: ' + utxoBalance)
    const balances = await this.getTokenBalances()
    const tokenBalance = balances.get('DFI')
    console.log('dfi: ' + tokenBalance)

    const amountFromBalance = new BigNumber(tokenBalance?.amount ?? '0')
    const fromUtxos = utxoBalance.gt(1) ? utxoBalance.minus(1) : new BigNumber(0)
    let amountToUse = fromUtxos.plus(amountFromBalance)
    console.log('amountToUse: ' + amountToUse)

    if (amountToUse.toNumber() < this.threshold) {
      console.log('Treshold not reached')
      return true
    }

    let txsToSign: CTransaction[] = []
    let prevout: Prevout | undefined = undefined

    if (amountFromBalance.toNumber() > 0) {
      console.log('convert ' + amountFromBalance.toFixed(4) + '@DFI' + ' to: UTXO')
      const utxoTx = await this.convertDFItoUTXO(amountFromBalance)
      txsToSign.push(utxoTx)
      prevout = this.prevOutFromTx(utxoTx)
    }

    console.log('send ' + amountToUse.toFixed(4) + '@UTXO' + ' to: ' + this.toAddress)
    const sendTx = await this.sendUTXOToAccount(amountToUse, this.toAddress, prevout)
    txsToSign.push(sendTx)

    if (!this.canSign()) {
      await this.sendTxDataToTelegram(txsToSign, telegram)
      return false
    }

    if (!(await this.waitForTx(sendTx.txId))) {
      await telegram.send('ERROR: sending of DFI failed')
      console.error('sending DFI failed')
      return false
    }

    await telegram.send('send ' + amountToUse.toFixed(4) + '@DFI' + ' to: ' + this.toAddress)

    return true
  }
}
