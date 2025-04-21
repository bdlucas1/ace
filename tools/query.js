"use strict";
const print = console.log
const printj = (j) => print(JSON.stringify(j, null, 2))

const osmtogeojson = require("osmtogeojson")
const turf = require("turf")

async function query(q) {

    const full_q = `
        [out:json][timeout:25];
           ${q}
        out body;
        >;
        out skel qt;
    `

    const api = "https://overpass-api.de/api/interpreter"
    const response = await fetch(api, {method: "POST", body: full_q,})
    try {
        const j = osmtogeojson(await response.json())
        return j
    } catch(e) {
        print(response.text())
    }
        
}

async function query_course_features(name, distance=5000) {

    const course_query = `
        way[leisure="golf_course"][name="${name}"];
    `
    const course = await query(course_query)
    const center = turf.centroid(course)
    const [lon, lat] = center.geometry.coordinates

    const features_query = `
        (
           way[golf="hole"](around:${distance},${lat},${lon});
           way[golf="tee"](around:${distance},${lat},${lon});
           way[golf="fairway"](around:${distance},${lat},${lon});
           way[golf="bunker"](around:${distance},${lat},${lon});
           way[golf="green"](around:${distance},${lat},${lon});
        );
    `
    const features = await query(features_query)
    printj(features)

}


async function query_courses(lat, lon, distance=20000) {

    const q = `
        (
            way[leisure=golf_course](around:${distance},${lat},${lon});
        );
    `
    printj(await query(q))
}

query_courses(41.32035685669253, -73.89382235173484)
//query_course_features("Hollow Brook Golf Club")

