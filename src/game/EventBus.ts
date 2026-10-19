import Phaser from 'phaser';

/**
 * Phaser ↔ React messages.
 *  - 'interact' (spot: SpotId)            player pressed E near a device
 *  - 'room' (room: RoomId)                player walked into a room
 *  - 'scene-ready' (scene: Phaser.Scene)  DataCenter scene finished creating
 */
export const EventBus = new Phaser.Events.EventEmitter();
