// Every world texture, as data: the Phaser baker (../textures.ts), the title backdrop and tests all read this list.
import { cabinetSpecs } from './cabinets';
import { coolingSpecs } from './cooling';
import { floorSpecs } from './floors';
import { markerSpecs } from './markers';
import { mentorSpecs } from './mentor';
import { nocSpecs } from './noc';
import type { TextureSpec } from './painter';
import { propSpecs } from './props';
import { rackSpecs } from './racks';

export function textureSpecs(): TextureSpec[] {
  return [
    ...floorSpecs(),
    ...rackSpecs(),
    ...cabinetSpecs(),
    ...coolingSpecs(),
    ...nocSpecs(),
    ...propSpecs(),
    ...markerSpecs(),
    ...mentorSpecs(),
  ];
}
