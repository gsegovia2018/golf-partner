package com.golfpartner.wear.data

/**
 * Phone <-> watch contract constants (v1). The contract itself is specified in
 * docs/superpowers/plans/2026-10-11-wear-os-watch-companion.md and implemented
 * on the phone in src/store/watchProtocol.js — change all three together.
 */
object Protocol {
    const val VERSION = 1

    /** Phone -> watch: DataItem holding the current round state. */
    const val STATE_PATH = "/golf/state"

    /** Key of the UTF-8 JSON payload inside the state DataItem. */
    const val STATE_KEY = "json"

    /** Watch -> phone: MessageClient path for commands. */
    const val COMMAND_PATH = "/golf/cmd"
}
