"use strict";

const print = console.log
const printj = (j) => print(JSON.stringify(j, null, 2))

const latlon = [41.32035685669253, -73.89382235173484]

var course
var map
var holeFeatures = []
var selectedHoleLayer
var selectedHole
var baseMaps

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
        zoomSnap: 0.1,
        zoomControl: false,
        rotateControl: false,
        layers: Object.values(baseMaps)[currentLayerNumber],
    })

    // our own layer switcher
    document.querySelector("#layer").addEventListener("click", () => {
        map.removeLayer(Object.values(baseMaps)[currentLayerNumber])
        currentLayerNumber = (currentLayerNumber + 1) % 3 // TODO
        print("switching to layer", currentLayerNumber)
        map.addLayer(Object.values(baseMaps)[currentLayerNumber])
    })


    // TODO: add location marker. don't need button to enable though...
    // a marker to track our location
    var locationMarker = undefined
    var lastLoc
    function createLocationMarker() {
        print("creating location marker")
        var CrosshairIcon = L.Icon.extend({
            options: {
                iconSize:     [30, 30],
                iconAnchor:   [15, 15],
            }
        });
        const crosshairIcon = new CrosshairIcon({iconUrl: "crosshair.png"})
        locationMarker = L.marker([0,0], {icon: crosshairIcon}).addTo(map)
    }
    function moveLocationMarker(loc, center) {
        const latlon = [loc.coords.latitude, loc.coords.longitude]
        print("moving location marker to", latlon, "centering", center)
        locationMarker.setLatLng(latlon)
        if (center)
            map.setView(latlon)
        lastLoc = loc
    }

    // TODO: sadly, this doesn't seem to work embedded in TNH website because
    // of permission policy issue - I think this is controlled at iframe level,
    // but could also be at http header level. Could this be overcome?
    //
    // watch our position and move the location marker accordingly
    if (locateControl && navigator.geolocation) {
        const LocateButton = L.Control.extend({
            options: {position: 'topright'},
            onAdd: function(map) {
                const button = L.DomUtil.create('div', 'leaflet-control locate-button');
                button.innerHTML = "<img src='crosshair.png'></img>"
                button.onclick = () => {
                    if (!locationMarker) {
                        createLocationMarker()
                        navigator.geolocation.watchPosition((loc) => moveLocationMarker(loc, false))
                    }
                    if (lastLoc)
                        moveLocationMarker(lastLoc, true)
                    else
                        navigator.geolocation.getCurrentPosition((loc) => moveLocationMarker(loc, true))
                };
                return button;
            }
        });
        //map.addControl(new LocateButton());
    }
}



async function selectHole(holeNumber) {

    print("selectHole", holeNumber)

    if (selectedHole) {
        document.querySelector(`#hole-number-${selectedHole}`).classList.remove("selected")
        document.querySelector(`#hole-score-${selectedHole}`).classList.remove("selected")
    }


    const feature = holeFeatures[holeNumber][0]
    const coordinates = feature.geometry.coordinates

    const bearing = turf.bearing(coordinates[0], coordinates[coordinates.length - 1])
    await map.setBearing(-bearing)
    
    if (selectedHoleLayer)
        map.removeLayer(selectedHoleLayer)
    selectedHoleLayer = L.geoJSON(holeFeatures[holeNumber], {
        style: feature => {
            switch (feature.properties.golf) {
            case 'green': return {color: 'green', class: 'foo'};
            case 'fairway': return {color: 'darkgreen'};
            case 'tee': return {color: 'blue'};
            case 'bunker': return {color: '#ffff40'};
            default: return {color: 'gray'};
            }
        }
    }).addTo(map);

    const center = turf.center({type: "FeatureCollection", features: holeFeatures[holeNumber]})
    const [lon, lat] = center.geometry.coordinates
    map.setView([lat, lon], 17)

    selectedHole = holeNumber
    document.querySelector(`#hole-number-${selectedHole}`).classList.add("selected")
    document.querySelector(`#hole-score-${selectedHole}`).classList.add("selected")
    
}


async function loadCourse() {


    const response = await fetch('test.geojson')
    course = await response.json()
    print(course)

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
        </div>
    `
    const layoutElt = document.querySelector("#layout")
    const mapElt = document.querySelector("#map")
    const scorecardElt = document.querySelector("#scorecard")

    await loadMap(mapElt, true, true)

    await loadCourse()

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

    
    function updateScore(holeNumber, update) {
        const td = document.querySelector(`#hole-score-${holeNumber}`)        
        const newScore = Number(td.innerText) + update
        td.innerText = newScore > 0? String(newScore) : " "
    }

    document.querySelector("#plus").addEventListener("click", () => updateScore(selectedHole, +1))
    document.querySelector("#minus").addEventListener("click", () => updateScore(selectedHole, -1))

    selectHole(1)
}

show()

