"use strict";

const print = console.log
const printj = (j) => print(JSON.stringify(j, null, 2))

const latlon = [41.32035685669253, -73.89382235173484]

var map
var holeFeatures = []
var selectedHoleLayer
var selectedHole
var baseMaps

var locationMarker = undefined
var accuracyMarker = undefined
var markers = []
var polyline
var lastLoc = undefined


// set up our map using Leaflet
function loadMap(elt, layerControl = true, locateControl = false) {

    // Thunderforest maps
    function thunderForest(type) {
        const key = "86d5ed83e1914677ba41e815a4126f2f"
        const url = `https://tile.thunderforest.com/landscape/{z}/{x}/{y}{r}.png?apikey=${key}`
        const attribution = `
            ©<a href='https://www.thunderforest.com' target='_blank'>Thunderforest</a> |
            ©<a href='https://www.openstreetmap.org/copyright' target='_blank'>OpenStreetMap</a>
        `
        return L.tileLayer(url, {attribution})
    }

    // color scheme is not as clear as Thunderforest
    // could be customized to be better
    // would have to look into caching if made default
    function mapBox(style) {
        const token =
              "pk.eyJ1IjoiYmRsdWNhczEiLCJhIjoiY2t5cW52dmI1MGx0ZjJ1cGV5NnM1eWw5NyJ9" +
              ".1ig0mdAnI6dBI5MtVf-JKA"
        const url = "https://api.mapbox.com/styles/v1/{style}/tiles/{z}/{x}/{y}{r}?access_token={token}"
        const attribution = `
            ©<a href='https://www.mapbox.com' target='_blank'>MapBox</a> |
            ©<a href='https://www.openstreetmap.org/copyright' target='_blank'>OpenStreetMap</a>
        `
        return L.tileLayer(url, {attribution, style, token, maxZoom: 20})
    }

    // USGS top maps
    function USGS(type, maxZoom=16) {
        const url = `https://basemap.nationalmap.gov/arcgis/rest/services/${type}/MapServer/tile/{z}/{y}/{x}`
        const attrURL = "https://basemap.nationalmap.gov/arcgis/rest/services"
        const attribution = `<a href='${attrURL}' target='_blank'>USGS</a>`
        return L.tileLayer(url, {attribution, maxZoom})
    }

    function OSM() {
        const url = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        return L.tileLayer(url, {maxZoom: 20})
    }

    function mapTiler() {
        const url = "https://api.maptiler.com/maps/satellite/{z}/{x}/{y}{r}.jpg?key=J95t1VSvDVTrfdsKsqyV"
        return L.tileLayer(url, {maxZoom: 20})
    }

    // these will be presented in the layer switch control
    const baseMaps = {
        "OSM": OSM(),
        "MapTiler satellite": mapTiler(),
        "MapBox satellite": mapBox("mapbox/satellite-streets-v12"),
        "Thunderforest landscape": thunderForest("landscape"),
        "MapBox outdoors": mapBox("mapbox/outdoors-v12"),
        "MapBox custom": mapBox("bdlucas1/ckyqokvgx03so14kg7zgkvfsd"),
        "USGS topo": USGS("USGSTopo"),
        "USGS imagery": USGS("USGSImageryOnly"),
        "USGS imagery topo": USGS("USGSImageryTopo"),
    }

    // create the map
    var currentLayerNumber = 0
    map = L.map(elt, {
        rotate: true,
        zoomSnap: 0.2,
        zoomControl: false,
        rotateControl: false,
        layers: Object.values(baseMaps)[currentLayerNumber],
    }).setZoom(16)

    // our own layer switcher
    document.querySelector("#layer").addEventListener("click", () => {
        map.removeLayer(Object.values(baseMaps)[currentLayerNumber])
        currentLayerNumber = (currentLayerNumber + 1) % 3 // TODO
        print("switching to layer", currentLayerNumber)
        map.addLayer(Object.values(baseMaps)[currentLayerNumber])
    })
}

async function selectHole(holeNumber) {

    print("selectHole", holeNumber)

    // deselect currently selected hole
    if (selectedHole) {
        document.querySelector(`#hole-number-${selectedHole}`).classList.remove("selected")
        document.querySelector(`#hole-score-${selectedHole}`).classList.remove("selected")
    }

    // compute and set bearing from start to end of hole
    const feature = holeFeatures[holeNumber][0]
    const coordinates = feature.geometry.coordinates
    const bearing = turf.bearing(coordinates[0], coordinates[coordinates.length - 1])
    await map.setBearing(-bearing)
    
    // select and show hole features
    if (selectedHoleLayer)
        map.removeLayer(selectedHoleLayer)
    selectedHoleLayer = L.geoJSON(holeFeatures[holeNumber], {
        style: feature => {return {className: `golf-${feature.properties.golf}`}}
    }).addTo(map);

    // center hole on map
    const center = turf.center({type: "FeatureCollection", features: holeFeatures[holeNumber]})
    const [lon, lat] = center.geometry.coordinates
    map.setView([lat, lon], 17)
    resetMarkers()

    // style selected hole on scorecard
    selectedHole = holeNumber
    document.querySelector(`#hole-number-${selectedHole}`).classList.add("selected")
    document.querySelector(`#hole-score-${selectedHole}`).classList.add("selected")
}

// do an Overpass query against OSM data
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
        const response_json = await response.json()
        const geojson = osmtogeojson(response_json)
        return geojson
    } catch(e) {
        print(response.text())
    }
}

// TODO: add query for all courses by binned lat/lon
// that will have the outline, so use that instead of
// querying it here
// TODO: handle missing golf course info
//    e.g. smaller distance?
// TODO: mechanism to clear cache. for now: at console, localStorage.clear()
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
    return features;
}

async function query_courses(lat, lon, distance=20000) {
    const q = `way[leisure=golf_course](around:${distance},${lat},${lon});`
    const courses = await query(q)
    const result = {}
    for (const course of courses.features) {
        const center = turf.centroid(course)
        const [lon, lat] = center.geometry.coordinates
        result[course.properties.name] = [lat, lon]
    }
    return result
}

async function cache_json(key, fun) {
    var value = localStorage.getItem(key)
    if (value) {
        print("using cached data for", key)
        return JSON.parse(value);
    } else {
        print("querying Overpass for", key)
        value = await fun()
        localStorage.setItem(key, JSON.stringify(value));
        return value
    }
}

async function loadCourse(name) {

    // get course data
    const course = await cache_json(name, () => query_course_features(name))

    // group features by nearest hole into holeFeatures array
    // holeFeatures is indexed by hole number,
    // and each element is an array of features associated with that hole
    // first element of each array is the hole feature (line representing hole) itself

    // first get the hole feature (line representing hole)
    for (const feature of course.features) {
        if (feature.properties.golf == "hole") {
            const holeNumber = feature.properties.ref
            holeFeatures[holeNumber] = [feature]

            // hack: extend line to first tee back because HB data is wrong
            const coordinates = feature.geometry.coordinates
            const [[a, b], [c, d]] = [coordinates[0], coordinates[1]]
            coordinates.unshift([a - 0.5*(c-a), b - 0.5*(d-b)])
        }
    }

    // then for each non-hole feature associate it with the closest hole
    for (const feature of course.features) {
        if (feature.properties.golf != "hole") {
            const centroid = turf.centroid(feature)
            var minDistance = Infinity
            var minHoleNumber
            for (const holeNumber in holeFeatures) {
                const holeFeature = holeFeatures[holeNumber][0]
                const distance = turf.pointToLineDistance(centroid, holeFeature)
                if (distance < minDistance) {
                    minDistance = distance
                    minHoleNumber = holeNumber
                }
            }
            holeFeatures[minHoleNumber].push(feature) 
        }
    }

}

function manageCourses()  {

    async function selectCourse() {

        const pos = await getPos()
        const [lat, lon] = [pos.coords.latitude.toFixed(2), pos.coords.longitude.toFixed(2)]
        const key = lat + "," + lon
        var courses = await cache_json(key, () => query_courses(lat, lon))
        for (const [course_name, latlon] of Object.entries(courses)) {
            L.marker(latlon).addTo(map).on("click", () => {
                loadCourse(course_name)
                selectHole(1)
            })
        }
        map.setZoom(11)
        map.setBearing(0)
    }


    const selectCourseButton = document.querySelector("#select-course")
    selectCourseButton.innerHTML = "<img src='golfer.png'></img>"
    selectCourseButton.addEventListener("click", selectCourse)

    selectCourse()
}


function defineIcon(width, height, url) {
    return L.Icon.extend({
        options: {
            iconSize: [width, height],
            iconAnchor: [width/2, height/2],
            iconUrl: url,
        }
    })
}

const CrosshairIcon = defineIcon(30, 30, "crosshair.png")

function resetMarkers() {
    for (const marker of markers)
        if (marker != locationMarker)
            marker.remove()
    markers = locationMarker? [locationMarker] : []
    updateLine()
}

// return current pos
async function getPos() {
    if (lastLoc) {
        // use last reported by watchPosition
        return lastLoc;
    } else {
        // otherwise ask
        const pos = await new Promise((resolve, reject) => {
            navigator.geolocation.getCurrentPosition(resolve, reject, {enableHighAccuracy: true})
        })
        return pos
    }
}

// turf point from anything that implements .getLatLng()
function turf_point(ll) {
    const {lat, lng} = ll.getLatLng()
    return turf.point([lng, lat])
}

// draw a line connecting markers and update distance info
// only use the location marker if it's visible in the current viewport
function updateLine() {

    // update the polyline
    const useMarkers = markers.filter(m => m!=locationMarker || map.getBounds().contains(m.getLatLng()))
    const lls = useMarkers.map(m => m.getLatLng())
    polyline.setLatLngs(lls)
    
    // update the distance info
    for (const m of markers)
        m.unbindTooltip()
    for (var i = 1; i < useMarkers.length; i++) {
        const distance = turf.distance(turf_point(useMarkers[i-1]), turf_point(useMarkers[i]), {units: "yards"})
        const tip = Math.round(distance) + " yd"
        useMarkers[i].bindTooltip(tip, {
            permanent: true,
            direction: "right",
            offset: L.point([20, 0]),
            className: "distance-info"
        })
    }
}

function svgIcon(innerSvg, className) {
    const icon = L.divIcon({
        html: `
          <svg class="${className}" viewBox="0 0 2 2"> 
            ${innerSvg}
          </svg>
        `,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
        //style: {overflow: visible},
        className: "svg-icon",
    })
    return icon
}


// move the locationMarker, optionally centering it
function moveLocationMarker(loc, center) {
    const latlon = [loc.coords.latitude, loc.coords.longitude]
    print("moving location marker to", latlon, "centering", center, "accuracy", loc.coords.accuracy, "m")
    locationMarker.setLatLng(latlon)
    accuracyMarker.setLatLng(latlon)
    accuracyMarker.setRadius(loc.coords.accuracy)
    if (center)
        map.setView(latlon)
    lastLoc = loc
    updateLine()
}

// center the current location in the map and reset markers
async function goToCurrentLocation() {
    
    // center on current position
    const loc = await getPos()
    moveLocationMarker(loc, true)
    
    // remove other markers
    resetMarkers()
}

function manageLocation() {
    
    // set up location and accuracy marker, and polyline
    locationMarker = L.marker([0,0], {icon: new CrosshairIcon()}).addTo(map)
    accuracyMarker = L.circleMarker([0,0], {
        radius: 100,
        color: "blue", opacity: 0.3,
        fillColor: "blue", fillOpacity: 0.1,
    }).addTo(map)
    polyline = L.polyline([], {className: "path-line"}).addTo(map)
    
    // watch for position changes, and update locationMarker accordingly
    // this does not center the locationMarker
    // if lastLoc is already set then it will be a test position so we don't
    // watch actual position
    if (!lastLoc) {
        navigator.geolocation.watchPosition(
            (loc) => moveLocationMarker(loc, false),
            print,
            {enableHighAccuracy: true}
        )
    }

    // locate button moves map to current location
    const locateButton = document.querySelector("#locate")
    locateButton.innerHTML = "<img src='crosshair.png'></img>"
    locateButton.addEventListener("click", goToCurrentLocation)

    // clicking on map adds a marker
    const markerIcon = svgIcon("<circle r='1'>", "path-marker")
    map.on("click", function(e) {

        print("click map")

        // create marker
        const marker = L.marker(e.latlng, {
            icon: markerIcon,
            draggable: true,
            autoPan: false,
            autoPanOnFocus: false, // https://github.com/Raruto/leaflet-rotate/issues/28
        }).addTo(map)
        markers.push(marker)

        // redraw line and update distance info to include new marker
        updateLine()

        // clicking marker removes it
        marker.on("click", () => {
            print("click marker")
            marker.remove()
            markers = markers.filter(m => m !== marker)
            updateLine()
        })

        // dragging marker updates line
        marker.on("drag", (e) => {
            print("drag")
            updateLine()
        })
    })

}

function manageScorecard() {

    // create score table
    for (var i = 1; i <= 9; i++) {
        var td = document.createElement("td")
        document.querySelector("#hole-number").appendChild(td)
        td.innerText = i
        td.id = `hole-number-${i}`
        td.addEventListener("click", function() {selectHole(Number(this.innerText))})
        td = document.createElement("td")
        document.querySelector("#hole-score").appendChild(td)
        td.holeNumber = i
        td.id = `hole-score-${i}`
        td.addEventListener("click", function() {selectHole(Number(this.holeNumber))})
    }

    // add or subtract one from score
    function updateScore(holeNumber, update) {
        const td = document.querySelector(`#hole-score-${holeNumber}`)        
        const newScore = Number(td.innerText) + update
        td.innerText = newScore > 0? String(newScore) : " "
    }

    // set up button click handlers
    document.querySelector("#plus").addEventListener("click", () => updateScore(selectedHole, +1))
    document.querySelector("#minus").addEventListener("click", () => updateScore(selectedHole, -1))
}


async function show() {

    document.body.innerHTML = `
        <div id="layout">
          <div id="map"></div>
          <table id="scorecard">
            <tr id="hole-number">
            <tr id="hole-score">
          </table>
          <div id="plus"></div>
          <div id="minus"></div>
          <div id="layer"></div>
          <div id="locate"></div>
          <div id="select-course"></div>
        </div>
    `
    const layoutElt = document.querySelector("#layout")
    const mapElt = document.querySelector("#map")
    const scorecardElt = document.querySelector("#scorecard")
    const locateElt = document.querySelector("#locate")

    await loadMap(mapElt, true, true)

    //await loadCourse("Sprain Brook Golf Course")
    //await loadCourse("Mohansic Golf Course") // TODO: this is missing; handle
    //await loadCourse("Putnam County Golf Course")
    //await loadCourse("Hollow Brook Golf Club")

    manageScorecard()

    manageLocation()

    goToCurrentLocation()

    manageCourses()

}

// parse parameters
const url = new URL(document.baseURI)
if (url.searchParams.has("testLoc")) {
    // testLoc sets lastLoc which disables watchPosition
    const [lat, lon] = url.searchParams.get("testLoc").split(",")
    lastLoc = {coords: {latitude: Number(lat), longitude: Number(lon), accuracy: 10}} 
    print(lastLoc)
}


show()

