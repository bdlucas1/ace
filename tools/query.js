"use strict";
const print = console.log
const printj = (j) => print(JSON.stringify(j, null, 2))

const osmtogeojson = require("osmtogeojson")

const latlon = [41.32035685669253, -73.89382235173484]

async function query(query) {

    const q = `
        [out:json][timeout:25];
        (
           way["leisure"="golf_course"](around:5000,${latlon[0]},${latlon[1]});
           way["golf"="hole"](around:5000,${latlon[0]},${latlon[1]});
           way["golf"="tee"](around:5000,${latlon[0]},${latlon[1]});
           way["golf"="fairway"](around:5000,${latlon[0]},${latlon[1]});
           way["golf"="bunker"](around:5000,${latlon[0]},${latlon[1]});
           way["golf"="green"](around:5000,${latlon[0]},${latlon[1]});
        );
        out body;
        >;
        out skel qt;
    `

    const api = "https://overpass-api.de/api/interpreter"
    const response = await fetch(api, {method: "POST", body: q,})
    const j = osmtogeojson(await response.json())

    printj(j)
}

query()

