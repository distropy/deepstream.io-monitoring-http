import { version } from '../package.json'
import { DeepstreamPlugin, DeepstreamServices, DeepstreamMonitoring, LOG_LEVEL, EVENT } from '@deepstream/types'
import { Message, ACTIONS } from '@deepstream/protobuf/dist/types/messages'
import { TOPIC, STATE_REGISTRY_TOPIC } from '@deepstream/protobuf/dist/types/all'
import { Server, IncomingMessage, ServerResponse } from 'http'

interface HTTPMonitoringOptions {
    host: string,
    port: number
}

export default class HTTPMonitoring extends DeepstreamPlugin implements DeepstreamMonitoring {
    public description = `HTTP Monitoring on ${this.options.host}:${this.options.port} Version: ${version}`
    private logger = this.services.logger.getNameSpace('HTTP_MONITORING')
    private errorLogs: { [index: string]: number } = {}
    private recieveStats: { [index: string]: { [index: string]: number } } = {}
    private sendStats: { [index: string]: { [index: string]: number } } = {}
    private loginStats: { [index: string]: {
        allowed: number,
        declined: number
    } } = {}
    private server: Server

    constructor (private options: HTTPMonitoringOptions, private services: DeepstreamServices) {
        super()
        this.server = new Server(this.onRequest.bind(this))
        this.server.on('error', (error) => {
            this.logger.fatal(EVENT.PLUGIN_INITIALIZATION_ERROR, `Error: ${error}`)
        })
    }

    public async whenReady (): Promise<void> {
        return new Promise((resolve) => {
            // Start the HTTP server, once it's succesfully listening resolve. If an error occurs
            // this will be caught by the general error event and will raise a fatal error with deepstream
            this.server.listen(this.options.port, this.options.host, () => resolve())
        })
    }

    public async close (): Promise<void> {
        return new Promise((resolve) => this.server.close(() => resolve()))
    }

    public onErrorLog (loglevel: LOG_LEVEL, event: EVENT, logMessage: string): void {
        const count = this.errorLogs[event]
        if (!count) {
            this.errorLogs[event] = 1
        } else {
            this.errorLogs[event] =  count + 1
        }
    }

    /**
     * Called whenever a login attempt is tried and whether or not it succeeded, as well
     * as the connection-endpoint type, which is provided from the connection endpoint
     * itself
     */
    public onLogin (allowed: boolean, endpointType: string): void {
        let stats = this.loginStats[endpointType]
        if (!stats) {
            stats = { allowed: 0, declined: 0 }
            this.loginStats[endpointType] = stats
        }
        allowed ? stats.allowed++ : stats.declined++
    }

    public onMessageRecieved (message: Message): void {
        let actionsMap = this.recieveStats[TOPIC[message.topic]]
        if (!actionsMap) {
            actionsMap = {}
            this.recieveStats[TOPIC[message.topic]] = actionsMap
        }
        const actionName = ACTIONS[message.topic][message.action!]
        actionsMap[actionName] = actionsMap[actionName] ? actionsMap[actionName] + 1 : 1
    }

    public onMessageSend (message: Message): void {
        let actionsMap = this.sendStats[TOPIC[message.topic]]
        if (!actionsMap) {
            actionsMap = {}
            this.sendStats[TOPIC[message.topic]] = actionsMap
        }
        const actionName = ACTIONS[message.topic][message.action!]
        actionsMap[actionName] = actionsMap[actionName] ? actionsMap[actionName] + 1 : 1
    }

    public onBroadcast (message: Message, count: number): void {
        let actionsMap = this.recieveStats[TOPIC[message.topic]]
        if (!actionsMap) {
            actionsMap = {}
            this.sendStats[TOPIC[message.topic]] = actionsMap
        }
        const actionName = ACTIONS[message.topic][message.action!]
        actionsMap[actionName] = actionsMap[actionName] ? actionsMap[actionName] + count : count
    }

    private onRequest (req: IncomingMessage, res: ServerResponse) {
        if (req.method !== 'GET') {
            res.writeHead(400)
            res.end('Only get supported')
            return
        }
        res.setHeader('Content-Type', 'application/json')
        res.writeHead(200)
        res.end(JSON.stringify(this.getAndResetMonitoringStats()))
    }

    private getAndResetMonitoringStats () {
        const results = {
            clusterSize: this.services.clusterRegistry.getAll().length,
            stateMetrics: this.getStateMetrics(),
            errors: this.errorLogs,
            recieved: this.recieveStats,
            send: this.sendStats,
            logins: this.loginStats
        }
        this.errorLogs = {}
        this.recieveStats = {}
        this.sendStats = {}
        this.loginStats = {}
        return results
    }

    private getStateMetrics () {
        const result: any = {}
        const stateRegistries = this.services.clusterStates.getStateRegistries()
        for (const [topic, stateRegistry] of stateRegistries) {
            result[TOPIC[topic] || STATE_REGISTRY_TOPIC[topic]] = stateRegistry.getAll().length
        }
        return result
    }

}
