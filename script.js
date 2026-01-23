function loadMarathonsFromURL(url, callback) {
    fetch(url)
        .then(response => {
            if (!response.ok) throw new Error("Nie udało się wczytać pliku");
            return response.text();
        })
        .then(text => {
            const lines = text.split(/\r?\n/).filter(line => line.trim() !== "");
            const marathonMap = new Map();

            lines.forEach(line => {
                const parts = line.split("|").map(p => p.trim());
                if(parts.length < 7) return;

                const [id, country, city, lonStr, latStr, type, date] = parts;
                const lon = parseFloat(lonStr);
                const lat = parseFloat(latStr);

                if (!marathonMap.has(id)) {
                    marathonMap.set(id, {
                        id: id,
                        country: country,
                        city: city,
                        lon: lon,
                        lat: lat,
                        marathons: []
                    });
                }

                marathonMap.get(id).marathons.push({ type: type, date: date });
            });

            const marathonPointsGrouped = Array.from(marathonMap.values());
            callback(marathonPointsGrouped);
        })
        .catch(err => console.error("Błąd wczytywania maratonów:", err));
}


const viewer = new Cesium.Viewer('cesiumContainer', {
    terrainProvider: new Cesium.EllipsoidTerrainProvider(),

    imageryProvider: new Cesium.OpenStreetMapImageryProvider({
        url: "https://a.tile.openstreetmap.org/"
    }),
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    timeline: false,
    navigationHelpButton: false,
    animation: false,
    creditsDisplay: false,    // usuwa box w górnym rogu
    selectionIndicator: false, // usuwa zielone ramki wokół punktów
    infoBox: false,
});

// Performance optimizations
viewer.scene.globe.maximumScreenSpaceError = 4; // Reduce terrain detail for better performance
viewer.scene.requestRenderMode = true; // Render only when needed
viewer.scene.fog.enabled = false; // Disable fog for simpler rendering
viewer.scene.globe.enableLighting = false; // Disable lighting for flat appearance and performance

const handler = viewer.cesiumWidget.screenSpaceEventHandler;

handler.removeInputAction(Cesium.ScreenSpaceEventType.LEFT_DOUBLE_CLICK);
handler.removeInputAction(Cesium.ScreenSpaceEventType.PINCH_MOVE);
handler.removeInputAction(Cesium.ScreenSpaceEventType.PINCH_END);

viewer.scene.screenSpaceCameraController.enableTilt = false;

let previousPinchDistance = null;

handler.setInputAction(function(twoPoints) {
    const dx = twoPoints.position2.x - twoPoints.position1.x;
    const dy = twoPoints.position2.y - twoPoints.position1.y;
    const distance = Math.sqrt(dx*dx + dy*dy);

    if (previousPinchDistance !== null) {
        const delta = distance - previousPinchDistance;
        viewer.camera.moveForward(-delta * 0.5);
    }

    previousPinchDistance = distance;
}, Cesium.ScreenSpaceEventHandler.TwoPointMotionEvent);

handler.setInputAction(function() {
    previousPinchDistance = null;
}, Cesium.ScreenSpaceEventHandler.TwoPointEndEvent);

viewer.imageryLayers.addImageryProvider(
    new Cesium.OpenStreetMapImageryProvider({ 
        url: 'https://a.tile.openstreetmap.org/',
        minimumLevel: 0,
        maximumLevel: 10 // Limit maximum zoom level for performance
    })
);

const scene = viewer.scene;
scene.skyBox.show = false;
scene.skyAtmosphere.show = false;
scene.sun.show = false;
scene.moon.show = false;

const ellipsoid = Cesium.Ellipsoid.WGS84;
const occluder = new Cesium.EllipsoidalOccluder(
    ellipsoid,
    viewer.camera.positionWC
);

viewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(55.2708,25.2048,9000000) });
scene.screenSpaceCameraController.minimumZoomDistance = 1000000;
scene.screenSpaceCameraController.maximumZoomDistance = 8571000*2;

const label = document.getElementById('uiLabel');
const labelText = document.getElementById('labelText');
const closeBtn = document.getElementById('closeBtn');

let activeEntity = null;

function hideOverlay() {
    activeEntity = null;
    label.style.display = 'none';
}

closeBtn.addEventListener('click', hideOverlay);

loadMarathonsFromURL("marathons.txt", function(marathonPoints){

    const points = marathonPoints.map(p => {
        const entity = viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(p.lon, p.lat, 1),
            billboard: {
                image: "star.png",
                width: 1,
                height: 1,
                verticalOrigin: Cesium.VerticalOrigin.BOTTOM
            }
        });
        entity.data = p;
        entity.clickState = 0;
        return entity;
    });

    const handler = new Cesium.ScreenSpaceEventHandler(scene.canvas);
    handler.setInputAction(function(click){
        const picked = scene.pick(click.position);
        if(Cesium.defined(picked) && picked.id){
            const entity = picked.id;

            if(entity.clickState === 0){
                entity.clickState = 1;
                activeEntity = entity;
                points.forEach(p => { if(p!==entity) p.clickState = 0; });

            } else {
                viewer.camera.flyTo({
                    destination: Cesium.Cartesian3.fromDegrees(
                        entity.data.lon,
                        entity.data.lat,
                        scene.screenSpaceCameraController.minimumZoomDistance
                    ),
                    duration: 1.5
                });
                entity.clickState = 0;
                activeEntity = entity;
            }

        } else {
            hideOverlay();
            points.forEach(p => p.clickState = 0);
        }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    viewer.scene.preRender.addEventListener(() => {
        if (activeEntity) {
            const pos = activeEntity.position.getValue(Cesium.JulianDate.now());
            const windowPos = scene.cartesianToCanvasCoordinates(pos);
            if (windowPos) {
                const labelHeader = document.getElementById('labelHeader');
                labelHeader.innerHTML = `${activeEntity.data.country}: ${activeEntity.data.city}`;

                const labelList = document.getElementById('labelList');
                labelList.innerHTML = "";
                activeEntity.data.marathons.forEach(m => {
                    const li = document.createElement("li");
                    li.innerHTML = `<b>${m.type}</b>: ${m.date}`;
                    labelList.appendChild(li);
                });

                let x = windowPos.x;
                let y = windowPos.y;

                const popup = document.getElementById('uiLabel');
                const popupWidth = popup.offsetWidth;
                const popupHeight = popup.offsetHeight;
                const padding = 10;

                if (x + popupWidth > window.innerWidth - padding) {
                    x = window.innerWidth - popupWidth - padding;
                }
                if (x < padding) x = padding;

                if (y + popupHeight > window.innerHeight - padding) {
                    y = window.innerHeight - popupHeight - padding;
                }
                if (y < padding) y = padding;

                popup.style.left = x + 'px';
                popup.style.top = y + 'px';
                label.style.display = 'block';
            }
        } else {
            label.style.display = 'none';
        }

        occluder.cameraPosition = viewer.camera.positionWC;
        points.forEach(entity => {
            const pos = entity.position.getValue(Cesium.JulianDate.now());
            entity.billboard.show = occluder.isPointVisible(pos);
        });
    });

    function adjustForOrientation() {
        const isPortrait = window.innerHeight > window.innerWidth;
        const isSmallScreen = window.innerWidth < 768;

        let starSize;
        if (isSmallScreen) {
            starSize = 80;
        } else if (isPortrait) {
            starSize = 64;
        } else {
            starSize = 32;
        }

        points.forEach(entity => {
            entity.billboard.width = starSize;
            entity.billboard.height = starSize;
        });

        const label = document.getElementById('uiLabel');
        if (isSmallScreen) {
            label.style.minWidth = '90%';
            label.style.fontSize = '20px';
            label.style.padding = '20px 25px';
        } else if (isPortrait) {
            label.style.minWidth = '458px';
            label.style.fontSize = '25px';
            label.style.padding = '18px 23px';
        } else {
            label.style.minWidth = '229px';
            label.style.fontSize = '16px';
            label.style.padding = '9px 14px';
        }
    }

    adjustForOrientation();
    window.addEventListener('resize', adjustForOrientation);
});