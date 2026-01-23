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


// Detect mobile devices for further optimizations
const isMobile = /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobile|webOS/i.test(navigator.userAgent);
const isSmallScreen = window.innerWidth < 1024; // Increased threshold
const isVerySmallScreen = window.innerWidth < 480;
const screenWidth = window.innerWidth;

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

if (isMobile || isSmallScreen) {
    viewer.resolutionScale = 0.5; // Reduce resolution for better performance on mobile
    viewer.scene.globe.maximumScreenSpaceError = 8; // Lower quality
    if (viewer.scene.postProcessStages && viewer.scene.postProcessStages.fxaa) {
        viewer.scene.postProcessStages.fxaa.enabled = false; // Disable anti-aliasing for performance
    }
}

if (isVerySmallScreen) {
    viewer.resolutionScale = 0.3; // Even lower for very small screens
    viewer.scene.globe.maximumScreenSpaceError = 16;
}

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

function getBearing(position, camera) {
    const direction = Cesium.Cartesian3.subtract(position, camera.position, new Cesium.Cartesian3());
    Cesium.Cartesian3.normalize(direction, direction);
    // Transform to camera space
    const cameraDirection = new Cesium.Cartesian3();
    Cesium.Matrix4.multiplyByPointAsVector(camera.viewMatrix, direction, cameraDirection);
    // Bearing in screen space
    return Math.atan2(cameraDirection.y, cameraDirection.x);
}

function getScreenEdgePosition(bearing, canvas) {
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const dx = Math.cos(bearing);
    const dy = Math.sin(bearing);
    let t = Infinity;
    if (dx > 0) t = Math.min(t, (canvas.width - centerX) / dx);
    if (dx < 0) t = Math.min(t, (0 - centerX) / dx);
    if (dy > 0) t = Math.min(t, (canvas.height - centerY) / dy);
    if (dy < 0) t = Math.min(t, (0 - centerY) / dy);
    const screenX = centerX + t * dx;
    const screenY = centerY + t * dy;
    return { x: screenX, y: screenY };
}

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

const arrowSizeNum = isSmallScreen ? screenWidth / 2 : 40;

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

        // Create arrow div for off-screen indication
        entity.arrowDiv = document.createElement('div');
        entity.arrowDiv.className = 'arrowIndicator';
        entity.arrowDiv.style.position = 'fixed';
        entity.arrowDiv.style.zIndex = '1001';
        entity.arrowDiv.style.width = arrowSizeNum + 'px';
        entity.arrowDiv.style.height = arrowSizeNum + 'px';
        entity.arrowDiv.style.padding = '8px 12px';
        entity.arrowDiv.innerHTML = '<img src="arrow.png" style="width:100%; height:100%; object-fit:contain;">';
        entity.arrowDiv.style.display = 'none';
        entity.arrowDiv.style.pointerEvents = 'auto'; // Enable clicks
        entity.arrowDiv.entity = entity; // Store reference
        entity.arrowDiv.addEventListener('click', function() {
            const ent = this.entity;
            viewer.camera.flyTo({
                destination: Cesium.Cartesian3.fromDegrees(ent.data.lon, ent.data.lat, scene.screenSpaceCameraController.minimumZoomDistance),
                duration: 1.5
            });
            // Hide active label if any
            if (activeEntity) {
                activeEntity = null;
                label.style.display = 'none';
            }
        });
        document.body.appendChild(entity.arrowDiv);

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
            const visible = occluder.isPointVisible(pos);
            entity.billboard.show = visible;
            if (!visible) {
                // Get screen position of the hidden point (even if behind)
                const screenPos = scene.cartesianToCanvasCoordinates(pos);
                if (screenPos) {
                    const canvasWidth = window.innerWidth;
                    const canvasHeight = window.innerHeight;
                    const centerX = canvasWidth / 2;
                    const centerY = canvasHeight / 2;
                    const dx = screenPos.x - centerX;
                    const dy = screenPos.y - centerY;
                    const len = Math.sqrt(dx * dx + dy * dy);
                    if (len > 0) {
                        const nx = dx / len;
                        const ny = dy / len;
                        // Calculate apparent radius of the globe
                        const d = Cesium.Cartesian3.distance(viewer.camera.positionWC, Cesium.Cartesian3.ZERO);
                        const radius = ellipsoid.maximumRadius;
                        const theta = Math.asin(radius / d);
                        const fovy = viewer.camera.frustum.fovy;
                        const pixelPerRad = canvasHeight / fovy;
                        const r = theta * pixelPerRad;
                        // Horizon position
                        const horizonX = centerX + nx * r;
                        const horizonY = centerY + ny * r;
                        let finalX = horizonX;
                        let finalY = horizonY;
                        // Check if out of Cesium container, if so, calculate new position on edge
                        if (finalX < 0 || finalX > canvasWidth || finalY < 0 || finalY > canvasHeight) {
                            // Line from center to horizon position, find intersection with container edge
                            const bearing = Math.atan2(ny, nx);
                            const edgePos = getScreenEdgePosition(bearing, {width: canvasWidth, height: canvasHeight});
                            finalX = edgePos.x;
                            finalY = edgePos.y;
                        }
                        // Rotate towards the star
                        const rotDx = screenPos.x - finalX;
                        const rotDy = screenPos.y - finalY;
                        let rotAngle = Math.atan2(rotDy, rotDx) * 180 / Math.PI;
                        // If star position is between arrow and center, opposite direction
                        const distArrow = Math.sqrt((finalX - centerX) ** 2 + (finalY - centerY) ** 2);
                        const distStar = Math.sqrt((screenPos.x - centerX) ** 2 + (screenPos.y - centerY) ** 2);
                        if (distStar < distArrow) {
                            rotAngle += 180;
                        }
                        let leftPos = finalX - arrowSizeNum / 2;
                        let topPos = finalY - arrowSizeNum / 2;
                        // Clamp to keep fully visible
                        if (leftPos < 0) leftPos = 0;
                        if (leftPos + arrowSizeNum > canvasWidth) leftPos = canvasWidth - arrowSizeNum;
                        if (topPos < 0) topPos = 0;
                        if (topPos + arrowSizeNum > canvasHeight) topPos = canvasHeight - arrowSizeNum;
                        entity.arrowDiv.style.left = leftPos + 'px';
                        entity.arrowDiv.style.top = topPos + 'px';
                        entity.arrowDiv.style.transform = `rotate(${rotAngle}deg)`;
                        entity.arrowDiv.style.display = 'block';
                    } else {
                        entity.arrowDiv.style.display = 'none';
                    }
                } else {
                    entity.arrowDiv.style.display = 'none';
                }
            } else {
                // Check if visible but out of container
                const screenPos = scene.cartesianToCanvasCoordinates(pos);
                if (screenPos && (screenPos.x < 0 || screenPos.x > window.innerWidth || screenPos.y < 0 || screenPos.y > window.innerHeight)) {
                    const canvasWidth = window.innerWidth;
                    const canvasHeight = window.innerHeight;
                    const centerX = canvasWidth / 2;
                    const centerY = canvasHeight / 2;
                    const dx = screenPos.x - centerX;
                    const dy = screenPos.y - centerY;
                    const len = Math.sqrt(dx * dx + dy * dy);
                    if (len > 0) {
                        const bearing = Math.atan2(dy, dx);
                        const edgePos = getScreenEdgePosition(bearing, {width: canvasWidth, height: canvasHeight});
                        const finalX = edgePos.x;
                        const finalY = edgePos.y;
                        // Rotate towards the star
                        const rotDx = screenPos.x - finalX;
                        const rotDy = screenPos.y - finalY;
                        const rotAngle = Math.atan2(rotDy, rotDx) * 180 / Math.PI;
                        let leftPos = finalX - arrowSizeNum / 2;
                        let topPos = finalY - arrowSizeNum / 2;
                        // Clamp to keep fully visible
                        if (leftPos < 0) leftPos = 0;
                        if (leftPos + arrowSizeNum > canvasWidth) leftPos = canvasWidth - arrowSizeNum;
                        if (topPos < 0) topPos = 0;
                        if (topPos + arrowSizeNum > canvasHeight) topPos = canvasHeight - arrowSizeNum;
                        entity.arrowDiv.style.left = leftPos + 'px';
                        entity.arrowDiv.style.top = topPos + 'px';
                        entity.arrowDiv.style.transform = `rotate(${rotAngle}deg)`;
                        entity.arrowDiv.style.display = 'block';
                    } else {
                        entity.arrowDiv.style.display = 'none';
                    }
                } else {
                    entity.arrowDiv.style.display = 'none';
                }
            }
        });
    });

    function adjustForDevice() {
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        // Calculate star size based on screen width (larger on smaller screens)
        let starSize;
        if (isSmallScreen) {
            starSize = screenWidth / 4;
        } else {
            starSize = 32;
        }

        points.forEach(entity => {
            entity.billboard.width = starSize;
            entity.billboard.height = starSize;
            // Update arrow size
            entity.arrowDiv.style.width = starSize + 'px';
            entity.arrowDiv.style.height = starSize + 'px';
        });

        const label = document.getElementById('uiLabel');
        const closeBtn = document.getElementById('closeBtn');
        if (isVerySmallScreen) {
            label.style.width = '50%';
            label.style.fontSize = '80px';
            label.style.padding = '80px 85px';
            closeBtn.style.padding = '70px 90px';
            closeBtn.style.fontSize = '32px';
        } else if (isSmallScreen) {
            label.style.width = '50%';
            label.style.fontSize = '72px';
            label.style.padding = '70px 75px';
            closeBtn.style.padding = '60px 80px';
            closeBtn.style.fontSize = '28px';
        } else {
            label.style.width = 'auto';
            label.style.minWidth = '229px';
            label.style.fontSize = '16px';
            label.style.padding = '9px 14px';
            closeBtn.style.padding = '6px 10px';
            closeBtn.style.fontSize = '16px';
        }
    }

    adjustForDevice();
    window.addEventListener('resize', adjustForDevice);
});