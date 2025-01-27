import { Box3, WebGLRenderer, Scene, DirectionalLight, AmbientLight, Group, MeshStandardMaterial, BufferGeometry, LineSegments, LineBasicMaterial, OrthographicCamera, Vector3, Mesh, Float32BufferAttribute, PlaneGeometry } from 'three';
import { GUI } from 'https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/libs/lil-gui.module.min.js';
import { mergeGeometries } from 'https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/utils/BufferGeometryUtils.js';
import { STLLoader } from 'https://cdn.jsdelivr.net/npm/three@0.158.0/examples/jsm/loaders/STLLoader.js';
import {ImprovedNoise} from 'https://unpkg.com/three/examples/jsm/math/ImprovedNoise.js';

import { ProjectionGenerator } from './ProjectionGenerator.js';

class CustomControls {
    constructor(object, domElement, camera) {
        this.object = object;
        this.domElement = domElement;
        this.camera = camera;
        
        this.rotationSpeed = 1.0;
        this.zoomSpeed = 1.0;
        this.enabled = true;
        
        this.isMouseDown = false;
        this.mouseX = 0;
        this.mouseY = 0;

        this.isRotating = false;

        
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onWheel = this.onWheel.bind(this);

		this.isProjecting = false;
        this.projectionTimeout = null;
        
        this.domElement.addEventListener('mousedown', this.onMouseDown);
        document.addEventListener('mousemove', this.onMouseMove);
        document.addEventListener('mouseup', this.onMouseUp);
        this.domElement.addEventListener('wheel', this.onWheel);
    }
    
    onMouseDown(event) {
        if (!this.enabled) return;
        this.isMouseDown = true;
        this.mouseX = event.clientX;
        this.mouseY = event.clientY;
    }

    onMouseMove(event) {
        if (!this.enabled || !this.isMouseDown) return;

        const deltaX = event.clientX - this.mouseX;
        const deltaY = event.clientY - this.mouseY;

        // Si c'est le premier mouvement après mouseDown
        if (!this.isRotating && (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2)) {
            this.isRotating = true;
            
            if (projection && projection.geometry) {
                projection.geometry.dispose();
                projection.geometry = new BufferGeometry();
            }
            
            model.visible = params.displayModel === 'color';
            shadedWhiteModel.visible = params.displayModel === 'shaded white';
            whiteModel.visible = params.displayModel === 'white';
            projection.visible = false;
        }

        if (this.isRotating) {
            this.object.rotateOnWorldAxis(
                new Vector3(0, 0, 1), 
                -deltaX * 0.01 * this.rotationSpeed
            );
            
            this.object.rotateOnWorldAxis(
                new Vector3(1, 0, 0), 
                deltaY * 0.01 * this.rotationSpeed
            );
        }

        this.mouseX = event.clientX;
        this.mouseY = event.clientY;
    }

    onMouseUp() {
        if (this.isRotating) {
            if (this.projectionTimeout) {
                clearTimeout(this.projectionTimeout);
            }
            
            this.projectionTimeout = setTimeout(async () => {
                if (!this.isMouseDown) {
                    await runUpdateEdges(30);
                    model.visible = false;
                    shadedWhiteModel.visible = false;
                    whiteModel.visible = false;
                    projection.visible = true;
                }
            }, 500);
        }
        
        this.isMouseDown = false;
        this.isRotating = false;
    }
    
    onWheel(event) {
        if (!this.enabled) return;
        
        event.preventDefault();
        
        const zoomFactor = 1.1;
        const direction = event.deltaY > 0 ? zoomFactor : 1 / zoomFactor;
        
        this.camera.left *= direction;
        this.camera.right *= direction;
        this.camera.top *= direction;
        this.camera.bottom *= direction;
        this.camera.updateProjectionMatrix();
    }
    
    dispose() {
        this.domElement.removeEventListener('mousedown', this.onMouseDown);
        document.removeEventListener('mousemove', this.onMouseMove);
        document.removeEventListener('mouseup', this.onMouseUp);
        this.domElement.removeEventListener('wheel', this.onWheel);
    }
}

const params = {
	threshold: 10,
	displayModel: 'color',
	displayProjection: false,
	sortEdges: true,
	includeIntersectionEdges: true,
};

let renderer, camera, scene, gui, controls;
let model, projection, polylineProjection, group, shadedWhiteModel;
let whiteModel = new Group();
let outputContainer;
let task = null;
let currentProjectionTask = null;
let debounceTimeout = null;

init();

async function init() {
    outputContainer = document.getElementById('output');
    const bgColor = 0x9c9c9c;

    // renderer setup
    renderer = new WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(window.devicePixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setClearColor(bgColor, 1);
    document.body.appendChild(renderer.domElement);

    // scene setup
    scene = new Scene();

    // lights
    const light = new DirectionalLight(0xffffff, 3.5);
    light.position.set(0, 100, 0);
    scene.add(light);

    const ambientLight = new AmbientLight(0xb0bec5, 1);
    scene.add(ambientLight);

    group = new Group();
    scene.add(group);

    // model = await loadSTL('https://raw.githubusercontent.com/photonsters/Slicer/master/STLs/bunny.stl');
	// model = await loadSTL('https://raw.githubusercontent.com/ChrisC413/bitey-bunny/master/bitey%20bunny.stl');	
    model = await loadScene();

    const boxM = new Box3();
    boxM.setFromObject(model);
    const sizeM = new Vector3();
    boxM.getSize(sizeM);
    const centerM = new Vector3();
    boxM.getCenter(centerM);
    model.position.sub(centerM);

    shadedWhiteModel = model.clone();
    const whiteMaterial = new MeshStandardMaterial({
        color: 0xcccccc,
    });
    shadedWhiteModel.traverse(c => {
        if (c.material) {
            c.material = whiteMaterial;
        }
    });

    // center group
    const box = new Box3();
    box.setFromObject(model, true);
    const size = new Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);
    box.getCenter(group.position).multiplyScalar(-1);
    group.position.y = Math.max(0, -box.min.y) + 1;

    // inital rotation
    group.rotateOnWorldAxis(new Vector3(1, 0, 0), Math.PI);
    group.rotateOnWorldAxis(new Vector3(0, 0, 1), Math.PI/3.6);

    group.add(model, shadedWhiteModel, whiteModel);

    // create projection display mesh
    projection = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0x000000}));
    scene.add(projection);

    polylineProjection = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0xffff00}));
    scene.add(polylineProjection);

    // camera setup
    const aspect = window.innerWidth / window.innerHeight;
    const distance = maxDim * 1.1 ;

    camera = new OrthographicCamera(
        -distance * aspect,
        distance * aspect,
        distance,
        -distance,
        0.01,
        1000
    );

    camera.position.set(0, distance, 0);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();


    // controls
    controls = new CustomControls(group, renderer.domElement, camera);
    gui = new GUI();
	gui.add(params, 'threshold', 0, 100).step(1).name('threshold').onChange(() => {
        if (debounceTimeout) clearTimeout(debounceTimeout);
        
        model.visible = true;
        shadedWhiteModel.visible = false;
        whiteModel.visible = false;
        projection.visible = false;
        
        debounceTimeout = setTimeout(async () => {
            if (debounceTimeout) {
                await runUpdateEdges(30);
                model.visible = false;
                shadedWhiteModel.visible = false;
                whiteModel.visible = false;
                projection.visible = true;
            }
        }, 500);
    });
    gui.add({ importSTL: async function() { await importSTL() }}, 'importSTL').name('Import STL');
    gui.add({ exportSVG: function() { projection.visible && exportProjectionToSVG() }}, 'exportSVG');
    gui.add({ exportSVG: function() { projection.visible && exportSingleProjectionToSVG() }}, 'exportSVG');

    render();

	// init projection
    await runUpdateEdges(30);
    model.visible = false;
    shadedWhiteModel.visible = false;
    whiteModel.visible = false;
    projection.visible = true;

    // resize handler
    window.addEventListener('resize', function() {
        const aspect = window.innerWidth / window.innerHeight;
        camera.left = -distance * aspect;
        camera.right = distance * aspect;
        camera.top = distance;
        camera.bottom = -distance;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });
}

async function loadSTL(url) {
	return new Promise((resolve, reject) => {
		fetch(url)
			.then(response => {
				return response.arrayBuffer();
			})
			.then(buffer => {
				
				const loader = new STLLoader();
				try {
					let geometry = loader.parse(buffer);

					console.log("Géométrie importée:", {
						vertices: geometry.attributes.position.count,
						faces: geometry.attributes.position.count / 3
					});
					
					const material = new MeshStandardMaterial({
						color: 0xcccccc,
					});

					const mesh = new Mesh(geometry, material);

					const modelGroup = new Group();
					modelGroup.add(mesh);

					resolve(modelGroup);
				} catch (error) {
					console.error("Erreur lors du parsing du STL:", error);
					reject(error);
				}
			})
			.catch(error => {
				console.error("Erreur détaillée:", error);
				reject(error);
			});
	});
}

async function loadScene() {
	return new Promise((resolve, reject) => {
		try {
            function generateHeight( width, height ) {

				const size = width * height, data = new Uint8Array( size ),
				perlin = new ImprovedNoise(), z = Math.random() * 100;

				let quality = 1;

				for ( let j = 0; j < 4; j ++ ) {

					for ( let i = 0; i < size; i ++ ) {

						const x = i % width, y = ~ ~ ( i / width );
						data[ i ] += Math.abs( perlin.noise( x / quality, y / quality, z ) * quality * 1.75 );

					}

					quality *= 5;

				}

				return data;

			}

            const worldWidth = 256, worldDepth = 256;
            const data = generateHeight( worldWidth, worldDepth );


            const geometry = new PlaneGeometry( 1000, 1000, worldWidth - 1, worldDepth - 1 );
            geometry.rotateX( - Math.PI / 2 );

            const vertices = geometry.attributes.position.array;

            for ( let i = 0, j = 0, l = vertices.length; i < l; i ++, j += 3 ) {
                vertices[ j + 1 ] = data[ i ];
            }

            const material = new MeshStandardMaterial({
                color: 0xcccccc,
            });

            const box = new Box3();
            const mesh = new Mesh(geometry, material);
            // mesh.rotation.z = Math.PI / 3;

            mesh.scale.set(0.5, 0.5, 0.5);

			scene.add( mesh );

            const modelGroup = new Group();
            modelGroup.add(mesh);

            // Centre le mesh et le groupe
            const groupBox = new Box3();
            groupBox.setFromObject(modelGroup);
            const groupCenter = groupBox.getCenter(new Vector3());
            mesh.position.sub(groupCenter);
            modelGroup.position.set(0, 0, 0);

            modelGroup.rotation.set(Math.PI/2, 0, 0);
            const localYAxis = new Vector3(0, 1, 0);
            modelGroup.rotateOnAxis(localYAxis, Math.PI/3.61);
            const localXAxis = new Vector3(1, 0, 0);
            modelGroup.rotateOnAxis(localXAxis, Math.PI/6);
    
            // modelGroup.rotation.z = - Math.PI / 2;
            // modelGroup.rotation.x = Math.PI / 1.55;
  

            resolve(modelGroup);
        } catch (error) {
            console.error("Erreur lors du parsing du STL:", error);
            reject(error);
        }
	});
}

async function importSTL() {
    return new Promise(async (resolve) => {
        // Arrêter la projection en cours si elle existe
        if (controls.projectionTimeout) {
            clearTimeout(controls.projectionTimeout);
        }

        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.stl';
        
        input.onchange = async (e) => {
            const file = e.target.files[0];
            
            // Clean up existing scene
            projection.visible = false;
            if (projection.geometry) {
                projection.geometry.dispose();
                projection.geometry = new BufferGeometry();
            }
            
            // Clean up existing models
            if (model) {
                model.traverse(child => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) child.material.dispose();
                });
            }
            if (shadedWhiteModel) {
                shadedWhiteModel.traverse(child => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) child.material.dispose();
                });
            }
            if (whiteModel) {
                whiteModel.traverse(child => {
                    if (child.geometry) child.geometry.dispose();
                    if (child.material) child.material.dispose();
                });
            }

            const buffer = await file.arrayBuffer();
            const loader = new STLLoader();
            const geometry = loader.parse(buffer);
            
            const material = new MeshStandardMaterial({
                color: 0xcccccc,
            });
            const mesh = new Mesh(geometry, material);
            const modelGroup = new Group();
            modelGroup.add(mesh);
            
            // Reset group position and rotation
            group.position.set(0, 0, 0);
            group.rotation.set(0, 0, 0);
            
            // Center and scale the model
            const box = new Box3();
            box.setFromObject(modelGroup);
            const size = new Vector3();
            box.getSize(size);
            const maxDim = Math.max(size.x, size.y, size.z);
            const center = new Vector3();
            box.getCenter(center);
            modelGroup.position.sub(center);

            // Create shaded white model
            const whiteMaterial = new MeshStandardMaterial({
                color: 0xcccccc,
            });
            shadedWhiteModel = modelGroup.clone();
            shadedWhiteModel.traverse(c => {
                if (c.material) {
                    c.material = whiteMaterial;
                }
            });

            // Update camera
            const aspect = window.innerWidth / window.innerHeight;
            const distance = maxDim * 1.1;
            camera.left = -distance * aspect;
            camera.right = distance * aspect;
            camera.top = distance;
            camera.bottom = -distance;
            camera.position.set(0, distance, 0);
            camera.lookAt(0, 0, 0);
            camera.updateProjectionMatrix();

            // Update scene with proper order
            group.remove(model, shadedWhiteModel, whiteModel);
            model = modelGroup;
            group.add(model, shadedWhiteModel, whiteModel);
            
            // Initial rotation comme dans init()
            group.rotateOnWorldAxis(new Vector3(1, 0, 0), Math.PI);
            group.rotateOnWorldAxis(new Vector3(0, 0, 1), Math.PI/3.6);
            
            await runUpdateEdges(30);
            model.visible = false;
            shadedWhiteModel.visible = false;
            whiteModel.visible = false;
            projection.visible = true;

            resolve();
        };
        
        input.click();
    });
}

function* updateEdges( runTime = 30 ) {
	if (projection.geometry) {
        projection.geometry.dispose();
        projection.geometry = new BufferGeometry();
        projection.geometry.setAttribute('position', new Float32BufferAttribute([], 3));
    }

	outputContainer.innerText = 'processing: --';

	// transform and merge geometries to project into a single model
	let timeStart = window.performance.now();
	const geometries = [];
	model.updateWorldMatrix( true, true );
	model.traverse( c => {

		if ( c.geometry ) {

			const clone = c.geometry.clone();
			clone.applyMatrix4( c.matrixWorld );
			for ( const key in clone.attributes ) {

				if ( key !== 'position' ) {

					clone.deleteAttribute( key );

				}

			}

			geometries.push( clone );

		}

	} );
    const mergedGeometry = mergeGeometries( geometries, false );
	const mergeTime = window.performance.now() - timeStart;

	yield;

	if ( params.includeIntersectionEdges ) {

		outputContainer.innerText = 'processing: finding edge intersections...';
		projection.geometry.dispose();
		projection.geometry = new BufferGeometry();

	}

	// generate the candidate edges
	timeStart = window.performance.now();

	let geometry = null;

		const generator = new ProjectionGenerator();
		generator.sortEdges = params.sortEdges;
		generator.iterationTime = runTime;
		generator.angleThreshold = params.threshold;
		generator.includeIntersectionEdges = params.includeIntersectionEdges;

		const task = generator.generate( mergedGeometry, {

			onProgress: ( p, data ) => {

				outputContainer.innerText = `processing: ${ parseFloat( ( p * 100 ).toFixed( 2 ) ) }%`;
				if ( params.displayProjection ) {

					projection.geometry.dispose();
					projection.geometry = data.getLineGeometry();

				}


			},

		} );

		let result = task.next();
		while ( ! result.done ) {

			result = task.next();
			yield;

		}

		geometry = result.value;


	const trimTime = window.performance.now() - timeStart;

	projection.geometry.dispose();

	projection.geometry = geometry;

	outputContainer.innerText =
		`merge geometry  : ${ mergeTime.toFixed( 2 ) }ms\n` +
		`edge trimming   : ${ trimTime.toFixed( 2 ) }ms`;

}

function runUpdateEdges(runTime = 30) {
    if (currentProjectionTask) {
        projection.geometry.dispose();
        projection.geometry = new BufferGeometry();
        projection.visible = false;
        model.visible = params.displayModel === 'color';
        shadedWhiteModel.visible = params.displayModel === 'shaded white';
        whiteModel.visible = params.displayModel === 'white';
        currentProjectionTask = null;
    }
    
    return new Promise((resolve) => {
        const iterator = updateEdges(runTime);
  
        function runNextStep() {
            const result = iterator.next();
  
            if (!result.done) {
                requestAnimationFrame(runNextStep);
            } else {
                // Post-traitement avec la géométrie finale
                processProjectionLines(projection.geometry);
                polylineProjection.visible = true;
                resolve();
            }
        }
  
        runNextStep();
    });
}

async function exportProjectionToSVG() {
    const positions = projection.geometry.attributes.position.array;
    const lines = [];
    
    // viewBox dimentions
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const z = positions[i + 2];
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, z);
        maxY = Math.max(maxY, z);
    }
    const targetWidth = 1000;
    const scale = targetWidth / (maxX - minX);
    
    // draw svg lines
    for (let i = 0; i < positions.length; i += 6) {
        const x1 = positions[i] * scale;
        const z1 = positions[i + 2] * scale;
        const x2 = positions[i + 3] * scale;
        const z2 = positions[i + 5] * scale;

        if (Math.abs(x1 - x2) > 0.0001 || Math.abs(z1 - z2) > 0.0001) {
            lines.push(`<line x1="${x1}" y1="${z1}" x2="${x2}" y2="${z2}" />`);
        }
    }
    
    const margin = targetWidth * 0.1; // margin 10%
    const viewBoxWidth = (maxX - minX) * scale + 2 * margin;
    const viewBoxHeight = (maxY - minY) * scale + 2 * margin;
    
    // init SVG
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" 
        viewBox="${minX * scale - margin} ${minY * scale - margin} ${viewBoxWidth} ${viewBoxHeight}">
    <g stroke="black" stroke-width="1" fill="none">
        ${lines.join('\n    ')}
    </g>
    </svg>`;
    
    // SVG download
    const blob = new Blob([svg], {type: 'image/svg+xml'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'projection.svg';
    link.click();
    URL.revokeObjectURL(url);
}

async function exportSingleProjectionToSVG(distance = 10) {
    const positions = polylineProjection.geometry.attributes.position.array;
    const uniquePoints = new Set();
    
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const z = positions[i + 2];
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, z);
        maxY = Math.max(maxY, z);
    }
    
    const targetWidth = 1000;
    const scale = targetWidth / (maxX - minX);
    
    // Collecter les points uniques
    for (let i = 0; i < positions.length; i += 6) {
        const x1 = positions[i] * scale;
        const z1 = positions[i + 2] * scale;
        const x2 = positions[i + 3] * scale;
        const z2 = positions[i + 5] * scale;
        
        uniquePoints.add(`${x1},${z1}`);
        uniquePoints.add(`${x2},${z2}`);
    }
    
    const points = Array.from(uniquePoints).map(p => {
        const [x, y] = p.split(',').map(Number);
        return {x, y};
    });
    
    const polylines = [];
    let currentPolyline = [];
    let remainingPoints = [...points];
    
    while (remainingPoints.length > 0) {
        if (currentPolyline.length === 0) {
            currentPolyline.push(remainingPoints[0]);
            remainingPoints.splice(0, 1);
        }
        
        let nearestIndex = -1;
        let minDist = Infinity;
        
        remainingPoints.forEach((point, index) => {
            const last = currentPolyline[currentPolyline.length - 1];
            const dist = Math.hypot(point.x - last.x, point.y - last.y);
            if (dist < minDist) {
                minDist = dist;
                nearestIndex = index;
            }
        });
        
        if (nearestIndex !== -1 && minDist <= distance * scale) {
            currentPolyline.push(remainingPoints[nearestIndex]);
            remainingPoints.splice(nearestIndex, 1);
        } else {
            if (currentPolyline.length > 1) {
                polylines.push(currentPolyline);
            }
            currentPolyline = [];
        }
    }
    
    if (currentPolyline.length > 1) {
        polylines.push(currentPolyline);
    }
    
    const margin = targetWidth * 0.1;
    const viewBoxWidth = (maxX - minX) * scale + 2 * margin;
    const viewBoxHeight = (maxY - minY) * scale + 2 * margin;
    
    const svgPolylines = polylines.map(polyline => {
        const points = polyline.map(p => `${p.x},${p.y}`).join(' ');
        return `<polyline points="${points}" />`;
    });
    
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" 
        viewBox="${minX * scale - margin} ${minY * scale - margin} ${viewBoxWidth} ${viewBoxHeight}">
    <g fill="none" stroke="red" stroke-width="2">
        ${svgPolylines.join('\n    ')}
    </g>
    </svg>`;
    
    const blob = new Blob([svg], {type: 'image/svg+xml'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'projection.svg';
    link.click();
    URL.revokeObjectURL(url);
}

function processProjectionLines(originalGeometry, distance = 10) {
    const positions = projection.geometry.attributes.position.array;
    const lines = [];
    const uniquePoints = new Set();
    
    for (let i = 0; i < positions.length; i += 6) {
        const start = new Vector3(positions[i], positions[i + 1], positions[i + 2]);
        const end = new Vector3(positions[i + 3], positions[i + 4], positions[i + 5]);
        
        if (!start.equals(end)) {
            lines.push({ start, end });
            uniquePoints.add(`${start.x},${start.y},${start.z}`);
            uniquePoints.add(`${end.x},${end.y},${end.z}`);
        }
    }
    
    const points = Array.from(uniquePoints).map(p => {
        const [x, y, z] = p.split(',').map(Number);
        return new Vector3(x, y, z);
    });
    
    const polylines = [];
    let currentPolyline = [];
    let remainingPoints = [...points];
    
    while (remainingPoints.length > 0) {
        if (currentPolyline.length === 0) {
            currentPolyline.push(remainingPoints[0]);
            remainingPoints.splice(0, 1);
        }
        
        let nearestIndex = -1;
        let minDist = Infinity;
        
        remainingPoints.forEach((point, index) => {
            const dist = currentPolyline[currentPolyline.length - 1].distanceTo(point);
            if (dist < minDist) {
                minDist = dist;
                nearestIndex = index;
            }
        });
        
        if (nearestIndex !== -1 && minDist <= distance) {
            currentPolyline.push(remainingPoints[nearestIndex]);
            remainingPoints.splice(nearestIndex, 1);
        } else {
            if (currentPolyline.length > 1) {
                polylines.push(currentPolyline);
            }
            currentPolyline = [];
        }
    }
    
    if (currentPolyline.length > 1) {
        polylines.push(currentPolyline);
    }
    console.log("Nombre de polylines:", polylines.length);

    const polylinePositions = [];
    polylines.forEach(polyline => {
        for (let i = 0; i < polyline.length - 1; i++) {
            polylinePositions.push(
                polyline[i].x, polyline[i].y, polyline[i].z,
                polyline[i + 1].x, polyline[i + 1].y, polyline[i + 1].z
            );
        }
    });
    
    polylineProjection.geometry.dispose();
    polylineProjection.geometry = new BufferGeometry();
    polylineProjection.geometry.setAttribute('position', new Float32BufferAttribute(polylinePositions, 3));
    
    return originalGeometry;
}

function render() {
	requestAnimationFrame(render);
    renderer.render(scene, camera);
}
