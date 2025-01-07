import {
	Box3,
	WebGLRenderer,
	Scene,
	DirectionalLight,
	AmbientLight,
	Group,
	MeshStandardMaterial,
	MeshBasicMaterial,
	BufferGeometry,
	LineSegments,
	LineBasicMaterial,
	OrthographicCamera,
	Vector3,
	Mesh,
	Float32BufferAttribute,
} from 'three';
import { GUI } from 'three/examples/jsm/libs/lil-gui.module.min.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ProjectionGenerator } from '../src/index.js';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';

class CustomControls {
    constructor(object, domElement, camera) {
        this.object = object;
        this.domElement = domElement;
        this.camera = camera;
        
        this.rotationSpeed = 1.0;
        this.zoomSpeed = 1.0;
        this.enabled = true;
        
        // État interne
        this.isMouseDown = false;
        this.mouseX = 0;
        this.mouseY = 0;
        
        // Lier les méthodes au contexte
        this.onMouseDown = this.onMouseDown.bind(this);
        this.onMouseMove = this.onMouseMove.bind(this);
        this.onMouseUp = this.onMouseUp.bind(this);
        this.onWheel = this.onWheel.bind(this);

		this.isProjecting = false;  // Nouvel état
        this.projectionTimeout = null;  // Pour gérer le délai
        
        // Ajouter les écouteurs d'événements
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
        
        // S'assurer que la projection existante est nettoyée
        if (projection && projection.geometry) {
            projection.geometry.dispose();
            projection.geometry = new BufferGeometry();
        }
        
        // Afficher le modèle, cacher la projection
        model.visible = params.displayModel === 'color';
        shadedWhiteModel.visible = params.displayModel === 'shaded white';
        whiteModel.visible = params.displayModel === 'white';
        projection.visible = false;
    }
    
    onMouseMove(event) {
		if (!this.enabled || !this.isMouseDown) return;
		
		const deltaX = event.clientX - this.mouseX;
		const deltaY = event.clientY - this.mouseY;
		
		// Rotation horizontale autour de l'axe X (puisqu'on est en vue de dessus)
		this.object.rotateOnWorldAxis(
			new Vector3(0, 0, 1), 
			-deltaX * 0.01 * this.rotationSpeed
		);
		
		// Rotation verticale autour de l'axe Z
		this.object.rotateOnWorldAxis(
			new Vector3(1, 0, 0), 
			deltaY * 0.01 * this.rotationSpeed
			
		);
		
		this.mouseX = event.clientX;
		this.mouseY = event.clientY;
	}
    
    onMouseUp() {
        this.isMouseDown = false;
        
        // Attendre un peu avant de lancer la projection
        if (this.projectionTimeout) {
            clearTimeout(this.projectionTimeout);
        }
        
        this.projectionTimeout = setTimeout(async () => {
            if (!this.isMouseDown) {  // Double vérification
                await runUpdateEdges(30);
                // Cacher le modèle, montrer la projection
                model.visible = false;
                shadedWhiteModel.visible = false;
                whiteModel.visible = false;
                projection.visible = true;
            }
        }, 500);  // Délai de 500ms
    }
    
    onWheel(event) {
        if (!this.enabled) return;
        
        event.preventDefault();
        
        // Ajuster le frustum de la caméra pour le zoom
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

async function exportProjectionToSVG() {
    // Récupérer les positions des points de la projection
    const positions = projection.geometry.attributes.position.array;
    const lines = [];
    
    // Calculer les dimensions pour le viewBox
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
        const x = positions[i];
        const z = positions[i + 2];
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, z);
        maxY = Math.max(maxY, z);
    }
    
    // Définir une taille cible en pixels
    const targetWidth = 1000;
    const scale = targetWidth / (maxX - minX);
    
    // Créer les lignes SVG avec mise à l'échelle
    for (let i = 0; i < positions.length; i += 6) {
        const x1 = positions[i] * scale;
        const z1 = positions[i + 2] * scale;
        const x2 = positions[i + 3] * scale;
        const z2 = positions[i + 5] * scale;
        
        // Ne garder que les lignes visibles (non dégénérées)
        if (Math.abs(x1 - x2) > 0.0001 || Math.abs(z1 - z2) > 0.0001) {
            lines.push(`<line x1="${x1}" y1="${z1}" x2="${x2}" y2="${z2}" />`);
        }
    }
    
    const margin = targetWidth * 0.1; // 10% de marge
    const viewBoxWidth = (maxX - minX) * scale + 2 * margin;
    const viewBoxHeight = (maxY - minY) * scale + 2 * margin;
    
    // Créer le SVG
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" 
     viewBox="${minX * scale - margin} ${minY * scale - margin} ${viewBoxWidth} ${viewBoxHeight}">
  <g stroke="black" stroke-width="1" fill="none">
    ${lines.join('\n    ')}
  </g>
</svg>`;
    
    // Télécharger le SVG
    const blob = new Blob([svg], {type: 'image/svg+xml'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'projection.svg';
    link.click();
    URL.revokeObjectURL(url);
}

const params = {
	threshold: 50,
	displayModel: 'color',
	displayProjection: false,
	sortEdges: true,
	includeIntersectionEdges: true,
};

async function loadSTL(url) {
	return new Promise((resolve, reject) => {
		fetch(url)
			.then(response => {
				return response.arrayBuffer();
			})
			.then(buffer => {
				
				const loader = new STLLoader();
				try {
					const geometry = loader.parse(buffer);
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

let renderer, camera, scene, gui;
let model, projection, group, shadedWhiteModel, whiteModel;
let outputContainer;
let task = null;

init();

async function init() {
    outputContainer = document.getElementById('output');
    const bgColor = 0xeeeeee;

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
    light.position.set(0, 1, 0);
    scene.add(light);

    const ambientLight = new AmbientLight(0xb0bec5, 1);
    scene.add(ambientLight);

    // load model
    group = new Group();
    scene.add(group);

    // Charger le STL
    // model = await loadSTL('https://raw.githubusercontent.com/photonsters/Slicer/master/STLs/bunny.stl');
	model = await loadSTL('https://raw.githubusercontent.com/ChrisC413/bitey-bunny/master/bitey%20bunny.stl');


	

    // Debug de la boîte englobante
    const boxM = new Box3();
    boxM.setFromObject(model);
    const sizeM = new Vector3();
    boxM.getSize(sizeM);
    const centerM = new Vector3();
    boxM.getCenter(centerM);

    // Centrer le modèle
    model.position.sub(centerM);

    const whiteMaterial = new MeshStandardMaterial({
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
    });
    shadedWhiteModel = model.clone();
    shadedWhiteModel.traverse(c => {
        if (c.material) {
            c.material = whiteMaterial;
        }
    });

    const whiteBasicMaterial = new MeshBasicMaterial({
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
    });
    whiteModel = model.clone();
    whiteModel.traverse(c => {
        if (c.material) {
            c.material = whiteBasicMaterial;
        }
    });

    group.updateMatrixWorld(true);

    // center group
    const box = new Box3();
    box.setFromObject(model, true);
    const size = new Vector3();
    box.getSize(size);
    const maxDim = Math.max(size.x, size.y, size.z);

    box.getCenter(group.position).multiplyScalar(-1);
    group.position.y = Math.max(0, -box.min.y) + 1;

    // Rotation initiale
    group.rotateOnWorldAxis(new Vector3(1, 0, 0), -Math.PI);
    group.rotateOnWorldAxis(new Vector3(0, 0, 1), Math.PI/5);

    group.add(model, shadedWhiteModel, whiteModel);

    // create projection display mesh
    projection = new LineSegments(new BufferGeometry(), new LineBasicMaterial({ color: 0x030303 }));
	projection.name = 'mainProjection';  // ajouter cet identifiant
    scene.add(projection);


    // Ajuster la caméra en fonction des dimensions du modèle
    const aspect = window.innerWidth / window.innerHeight;
    const distance = maxDim ;

    camera = new OrthographicCamera(
        -distance * aspect,
        distance * aspect,
        distance,
        -distance,
        0.01,
        maxDim * 10
    );

    camera.position.set(0, distance, 0);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();

    // controls
    controls = new CustomControls(group, renderer.domElement, camera);

    gui = new GUI();
	gui.add(params, 'threshold', 1, 50).name('threshold');
    gui.add({ exportSVG: function() { exportProjectionToSVG(); }}, 'exportSVG');

    render();

	// Faire la projection initiale
    await runUpdateEdges(30);

    // Cacher le modèle, montrer la projection
    model.visible = false;
    shadedWhiteModel.visible = false;
    whiteModel.visible = false;
    projection.visible = true;

    // Handler de redimensionnement
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
	return new Promise((resolve) => {
	  const iterator = updateEdges(runTime);
  
	  function runNextStep() {
		const result = iterator.next();
  
		if (!result.done) {
		  // Si ce n'est pas terminé, continuer à exécuter les étapes
		  requestAnimationFrame(runNextStep);
		} else {
		  // Si terminé, résoudre la promesse
		  resolve();
		}
	  }
  
	  runNextStep();
	});
}

function render() {

	requestAnimationFrame(render);
    
    if (task) {
        const res = task.next();
        if (res.done) {
            task = null;
        }
    }

    renderer.render(scene, camera);

}
