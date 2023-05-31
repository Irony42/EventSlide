import express from 'express'
import passport from 'passport'
import { log } from './log'
import { AddressInfo } from 'net'

const app = express()

const server = app.listen(4300, () => log.debug(`Listening on port ${(server.address() as AddressInfo).port}`))

