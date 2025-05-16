// magic glue that gets us types for turf, maplibre-gl, and lerc
// ChatGPT helped me write this, can't claim to really understand it
// (and ChatGPT didn't get the maplibre one quite right either)

// Turf
import * as turfNamespace from '@turf/turf';
declare global {
    const turf: typeof turfNamespace;
}

// MapLibre
import * as maplibreNamespace from 'maplibre-gl';

// Lerc
import * as lercNamespace from 'lerc';
declare global {
    const Lerc: typeof lercNamespace;
}

// osmtogeojson
import * as osmtogeojson from 'osmtogeojson';


