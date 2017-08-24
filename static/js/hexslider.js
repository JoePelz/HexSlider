/* Ideas/questions/notes/plans:
S Why not "use strict" at the top of file and be done with it?
S Idea: Convert internal representation of nodes to a standard integer grid, 
        and have a function that maps grid points (scale + translate) to the
        tiled triangular grid for rendering.
S Idea re walls:
    Player does not "turn", player creates wall at vertex and bounces off of it.
    Walls should not last forever.
    Walls influence all players that run into them.
S Maybe change global e (triangle height) to actually represent triangle edge length. Thoughts?
S Problem!!!! If players end with the same position and direction, they perfectly cover each other
  and can't get away (without something special like a powerup that applies to only one of them).
  To each player, it looks like the other one died.
*/

/*
The data representation of objects is as if they are on a grid, or interpolating
between points along the grid. The grid has edges connecting the vertices like so:
 __ __ __ __ __
|\ |\ |\ |\ |\ |
|_\|_\|_\|_\|_\|
|\ |\ |\ |\ |\ |
|_\|_\|_\|_\|_\|
|\ |\ |\ |\ |\ |
|_\|_\|_\|_\|_\|

When the grid is translated into screen coordinates, it is sheared into a right-leaning rhombus:
         __  __  __  __  __
       /\  /\  /\  /\  /\  /
      /__\/__\/__\/__\/__\/
     /\  /\  /\  /\  /\  /
    /__\/__\/__\/__\/__\/
   /\  /\  /\  /\  /\  /
  /__\/__\/__\/__\/__\/

*/
function toScreenSpace(gc) {
	//To get screen coordinates from grid coordinates, scale and shear into right/leaning rhombus
	var sc = new Point();
	sc.x = gc.x * edge_len + gc.y * half_edge_len;
	sc.y = gc.y * tri_height;
	return sc;
}
function toGridSpace(sc) {
	//Screen coordinates to grid coordinates
	var gc = new Point();
	gc.y = sc.y / tri_height;
	gc.x = (sc.x - gc.y * half_edge_len) / edge_len;
	return gc;
}
function toNearestGridPoint(sc) {
	//Screen coordinates to nearest grid point
	var gc = toGridSpace(sc);
	gc.x = Math.round(gc.x);
	gc.y = Math.round(gc.y);
	return gc;
}

var lcanvas;
var rcanvas;
var lctx;
var rctx;

const grid_max_x = 10;
const grid_max_y = 10;
const edge_len = 115.47;
const half_edge_len = edge_len / 2;
const tri_height = Math.sqrt(edge_len*edge_len*3/4);

const r = 300; //circumscribed hexagonal playing field radius (distance from center to middle of edge, not center to corner)
const e = 100; //triangle height; should evenly divide `r`
               //note: this is not triangle edge length.
const s = r * Math.tan(Math.PI/6); //half of a side length (for larger game hexagon)
const t = 2*s*e / r; //triangle edge length

var tracking = false;
var tiling = false;

var time_old = -1;

var p1 = {};
var p2 = {};
var p_default = {};
var gameSpeed = 0.1;

var testPoint = new Point(-1000, -1000);

var candies = [];
var walls = [];

//Key handling reference: http://unixpapa.com/js/key.html
var KEY_CODE = {
    Enter: 13,
    Space: 32,
    Tab:    9,
    Esc:   27,
    Shift: 16,
    Ctrl:  17,
    Alt:   18,
    Arrow_Left:  37,
    Arrow_Up:    38,
    Arrow_Right: 39,
    Arrow_Down:  40
    };
if (Object.freeze) Object.freeze(KEY_CODE);

function onResize() {
    "use strict";
    lcanvas.width = window.innerWidth * 0.48;
    lcanvas.height = window.innerHeight * 0.96;
    rcanvas.width = window.innerWidth * 0.48;
    rcanvas.height = window.innerHeight * 0.96;
}

(function () {
    "use strict";
    var throttle = function (type, name, obj) {
        obj = obj || window;
        var running = false;
        var func = function () {
            if (running) {
                return;
            }
            running = true;
             requestAnimationFrame(function () {
                obj.dispatchEvent(new CustomEvent(name));
                running = false;
            });
        };
        obj.addEventListener(type, func);
    };
    throttle("resize", "optimizedResize");
}());

// handle event
window.addEventListener("optimizedResize", onResize);


function init() {
    "use strict";
    lcanvas = document.getElementById("left");
    rcanvas = document.getElementById("right");
    lctx = lcanvas.getContext("2d");
    rctx = rcanvas.getContext("2d");

    candies.push(new Candy(generate_random_vertex()));
    candies.push(new Candy(generate_random_vertex()));
    candies.push(new Candy(generate_random_vertex()));

    p1 = new Player();
    p1.keyLeft = 'A'.charCodeAt();  //a=65; d=68;
    p1.keyRight = 'D'.charCodeAt();
    p2 = new Player();
    p2.keyLeft = KEY_CODE.Arrow_Left;  //<=37; >=39;
    p2.keyRight = KEY_CODE.Arrow_Right;
    p_default = new Player();
	p1.endVertex = new Point(-2, 0);
	p1.setTrajectory(0);
	p1.step(0);
	p2.endVertex = new Point(2, 0);
	p2.setTrajectory(3);
	p2.step(0);
    p1.path = new Line(-2 * s, 0, -2 * s + t, 0);
    p2.path = new Line(2 * s, 0, 2 * s - t, 0);

    window.onkeydown = event_keydown;
    window.onmousedown = event_mdown;

    onResize();

    requestAnimationFrame(mainloop_init);
}

function init_board() {
    //  2    1
    //   \  /
    // 3 -  - 0
    //   /  \
    //  4    5
    board = [];
    rows = [];
}
function Candy(p) {
    this.x = p.x;
    this.y = p.y;
    this.effect = {
        "speedMultiplier": 24,
        "duration": 3
    };
}

function Wall(pos, orient, size) {
    //Size param is optional
    this.x = pos.x;	//Coordinates are in grid space
    this.y = pos.y;
    this.orientation = orient; //Should be 0-2... 0: --, 1: /, 2: \ .
    this.maxSize = size || t/6;
    //this.ttl = 1000;
}
Wall.prototype.ttl = 2000; //ttl is decremented over time for each Wall
Wall.prototype.tIn = 50;
Wall.prototype.tOut = 250;

function update_walls(dt) {
    var i = walls.length;
    while (i--) {
        var w = walls[i]
        w.ttl -= dt;
        if (w.ttl <= 0) { //TTL expired
            //Replace current wall with last wall, and shrink array by 1 element
            walls[i] = walls[walls.length - 1];
            walls.length--;
        }
        
    }
}
        
function renderWalls(context) {
    var xCoef = Math.cos(Math.PI/3); //coef for x-component when wall on an angle
    var yCoef = Math.sin(Math.PI/3);
    context.lineWidth = 4;
    context.strokeStyle = "#000000";
    context.beginPath();
    walls.forEach(function (wall) {
        var hl = wall.maxSize; //half-length of wall
        //Fade in/out based on ttl
        if (wall.ttl > (Wall.prototype.ttl - wall.tIn)) {
            hl *= (Wall.prototype.ttl - wall.ttl) / wall.tIn;
        } else if (wall.ttl < wall.tOut) {
            hl *= wall.ttl / wall.tOut;
        }
        var hlx = hl * xCoef;  //half-length x when wall on an angle
        var hly = hl * yCoef;
		var w = toScreenSpace(wall);
        switch(wall.orientation) {
            case 0: //Horizontal Wall
                context.moveTo(w.x-hl, w.y);
                context.lineTo(w.x+hl, w.y);
                break;
            case 1: //Forwardslash Wall
                context.moveTo(w.x-hlx, w.y-hly);
                context.lineTo(w.x+hlx, w.y+hly);
                break;
            case 2: //Backslash Wall
                context.moveTo(w.x-hlx, w.y+hly);
                context.lineTo(w.x+hlx, w.y-hly);
                break;
        }
    });
    context.stroke();
}

function Point(x, y) {
    "use strict";
    this.x = x;
    this.y = y;
    this.minus = function(p2) {
        return new Point(this.x - p2.x, this.y - p2.y);
    }
    this.plus = function(p2) {
        return new Point(this.x + p2.x, this.y + p2.y);
    }
    this.scale = function(factor) {
        return new Point(this.x * factor, this.y * factor);
    }
    this.normalize = function() {
        var len = Math.sqrt(this.x * this.x + this.y * this.y);
        return new Point(this.x / len, this.y / len);
    }
    this.lerp = function(p2, percent) {
        return new Point(this.x + percent * (p2.x - this.x),
                        this.y + percent * (p2.y - this.y));
    }
    this.toString = function() {
        return "(" + this.x + ", " + this.y + ")";
    }
}

function Line(x1, y1, x2, y2) {
    "use strict";
    this.start = new Point(x1, y1);
    this.end = new Point(x2, y2);
    //@TODO This length is not updated if start or end are modified after Line creation (it's not a function)
    this.length = Math.sqrt((x2-x1)*(x2-x1) + (y2-y1)*(y2-y1));
    this.reverse = function() {
        var temp = this.start;
        this.start = this.end;
        this.end = temp;
    }
    this.lerp = function(percent) {
        return this.start.lerp(this.end, percent);
    }
    this.toString = function() {
        return this.start.toString() + " -> " + this.end.toString();
    }
}

function Player() {
    "use strict";
    this.radius = 10;
    this.keyLeft;
    this.keyRight;
    this.speedMultiplier = 12.0;
    this.speedOffset = 0.0;
    this.path = new Line(-2 * s, 0, 2 * s, 0);
    this.effects = {};
    this.effectsQueue = [];
    this.setPos = function(newPos) {
        var tempPos = newPos;
        tempPos *= this.speedMultiplier;
        tempPos -= this.speedOffset;
        if (tempPos < 0) {
            tempPos += this.speedOffset;
            this.speedOffset = 0;
        } else if (tempPos > 1) {
            this.speedOffset += 1;
        }
        this.pos = tempPos;
    };
    this.keyPress = function(key) {
        var direction = 0;
        if (key === this.keyLeft) direction = 1;
        if (key === this.keyRight) direction = -1;
        if (!direction) return false; //Keypress not handled
        
        //Path angle is either +1 to left or -1 to right. +2 is like -1 but without risk of going negative
        var pa = (this.trajectory + ((direction == 1) ? 1 : 2)) % 3;
        walls.push(new Wall(this.endVertex, pa));
        
        return true; //Keypress handled
    };
	
	this.trajectory = 0; 				//Value 0-5, signifying which direction player is travelling
	this.startVertex = new Point(1, 1);	//Player is moving away from this vertex (grid space)
	this.endVertex = new Point(2, 1);	//Player is moving toward this vertex (grid space)
	this.percent_travelled = 0;	//How far player is between startVertex (0) and endVertex (1)
	this.gridCoord;				//Current player coordinates, in grid space
	this.screenCoord;			//Current player coordinates, in screen space
	this.setTrajectory = function(newTrajectory) {
		this.trajectory = newTrajectory;
		this.startVertex = this.endVertex;
		//TODO How do we make sure to wrap the whole path properly. Joe probably already solved it in wrap_path but I am le tired.
		wrapPoint(this.startVertex);
		var trajectory_dx = [1, 0, -1, -1,  0,  1];
		var trajectory_dy = [0, 1,  1,  0, -1, -1];
		var dx = trajectory_dx[newTrajectory];
		var dy = trajectory_dy[newTrajectory];
		this.endVertex = this.endVertex.plus(new Point(dx, dy));
		this.step(-1); //Reset percent_travelled and set new coords
	};
	this.step = function(pct) {
		//Call this every frame to update player's position
		//Step forward pct% of an edge length
		this.percent_travelled += pct;
		this.gridCoord = this.startVertex.lerp(this.endVertex, this.percent_travelled);
		this.screenCoord = toScreenSpace(this.gridCoord);
	}
    
}

function wrapPoint(p) {
	if (p.x < 0) p.x += grid_max_x;
	else if (p.x > grid_max_x - 1) p.x -= grid_max_x;
	
	if (p.y < 0) p.y += grid_max_y;
	else if (p.y > grid_max_y - 1) p.y -= grid_max_y;
}

function getPathAngleIgnoreDirection(line) {
    "use strict";
    var result = getPathAngle(line);
    return (result > 2) ? result - 3 : result;
}

function getPathAngle(line) {
    "use strict";
    //  2    1
    //   \  /
    // 3 -  - 0
    //   /  \
    //  4    5
    var dx = line.end.x - line.start.x;
    var dy = line.end.y - line.start.y;
    if (dy > -0.0001 && dy < 0.0001){//dy == 0) {    //Horizontal Line
        if (dx > 0) return 0; //going right
        if (dx > 0) return 0; //going right
        else        return 3; //going left
    } else {          //Angled Line
        if (dx > 0) {
            if (dy > 0) return 1;
            else        return 5;
        } else {
            if (dy > 0) return 2;
            else        return 4;
        }
    }
}

function setupTransform(player, ctx) {
    "use strict";
    //center view
    ctx.scale(1, -1);
    ctx.translate(lcanvas.width / 2, -lcanvas.height / 2); //ok because lcanvas and rcanvas dimensions are equal

    //track the player
    if (tracking) {
        var pos = player.screenCoord;
        ctx.translate(-pos.x, -pos.y);
    }
}

function renderBG(context) {
    "use strict";

    var a;
    var w;
    context.save();
    context.beginPath();
	
	//@TEST CODE
	renderTriangleGrid(context);
    context.lineWidth = 1;
    context.stroke();
	
    //draw horizontal lines
    for (a = -r; a <= r; a += e) {
        w = (r - Math.abs(a)) / r * s + s;
        context.moveTo(-w, a);
        context.lineTo( w, a);
    }
    context.rotate(Math.PI / 3);
    //draw horizontal lines
    for (a = -r; a <= r; a += e) {
        w = (r - Math.abs(a)) / r * s + s;
        context.moveTo(-w, a);
        context.lineTo( w, a);
    }
    context.rotate(Math.PI / 3);
    //draw horizontal lines
    for (a = -r; a <= r; a += e) {
        w = (r - Math.abs(a)) / r * s + s;
        context.moveTo(-w, a);
        context.lineTo( w, a);
    }
	
    context.stroke();
    context.restore();
}

//@EXPERIMENTAL
function renderTriangleGrid(context) {
    "use strict";
    context.save();
    context.beginPath();
    context.scale(1, -1);
    context.translate(-lcanvas.width / 2, -lcanvas.height / 2); //ok because lcanvas and rcanvas dimensions are equal
	context.lineWidth = 1;
	
	var edge = edge_len;//100;
	var half_edge = edge / 2;
	var height = Math.sqrt(edge*edge*3/4);
	var uporient = true;
	var row_max = lcanvas.height / height-1; //TODO: remove -1, just there for debugging
	for(var tri_row = 0; tri_row < row_max; tri_row++) {
		var row_odd = tri_row & 1;
		var col_max = (-2 + lcanvas.width / half_edge) & ~1 -row_odd;
		for(var tri_col = -row_odd; tri_col < col_max; tri_col++) {
			var x1 = tri_col * half_edge + (tri_row % 2 ? half_edge : 0);
			var x2 = x1 + half_edge;
			var x3 = x2 + half_edge;
			var y1 = tri_row * height;
			var y2 = y1 + height;
			if (uporient) { //draw triangle with pointy top
				context.moveTo(x2, y1);
				context.lineTo(x3, y2);
				context.lineTo(x1, y2);
				context.lineTo(x2, y1);
			} else {			//draw triangle with pointy bottom
				context.moveTo(x1, y1);
				context.lineTo(x3, y1);
				context.lineTo(x2, y2);
				context.lineTo(x1, y1);
			}
			uporient = !uporient;
		}
		uporient = !uporient
	}
	
    context.stroke();
    context.restore();
}

function renderPlayer(player, context) {
    "use strict";
    context.beginPath();
    var pos = player.screenCoord;
    context.arc(pos.x, pos.y, player.radius, 0, 2 * Math.PI, false);
    context.stroke();
	//@TEST CODE
    context.beginPath();
    pos = toScreenSpace(player.startVertex);
    context.arc(pos.x, pos.y, player.radius-5, 0, 2 * Math.PI, false);
    context.stroke();
    context.beginPath();
    pos = toScreenSpace(player.endVertex);
    context.arc(pos.x, pos.y, player.radius-5, 0, 2 * Math.PI, false);
    context.stroke();
}

function renderClear() {
    "use strict";
    lctx.resetTransform();
    rctx.resetTransform();

    lctx.fillStyle = "#CCCCFF";
    lctx.fillRect(0, 0, lcanvas.width, lcanvas.height);
    rctx.fillStyle = "#FFCCCC";
    rctx.fillRect(0, 0, rcanvas.width, rcanvas.height);
}

function renderTiledGame() {
    const positions = 
        [ [0, 0]
        , [0, +2 * r]
        , [0, -2 * r]
        , [-3 * s, r]
        , [+3 * s, r]
        , [-3 * s, -r]
        , [+3 * s, -r]
        ];

    renderClear();
    setupTransform(p1, lctx);
    setupTransform(p2, rctx);

    positions.forEach(function (pos) {
        lctx.save();
        rctx.save();
        lctx.translate(pos[0], pos[1]);
        rctx.translate(pos[0], pos[1]);

        lctx.lineWidth = 1;
        lctx.strokeStyle = "#000000";
        renderBG(lctx);
        rctx.lineWidth = 1;
        rctx.strokeStyle = "#000000";
        renderBG(rctx);

        lctx.lineWidth = 5;
        lctx.strokeStyle = "#FF0000";
        renderPlayer(p2, lctx);
        lctx.strokeStyle = "#0000FF";
        renderPlayer(p1, lctx);

        rctx.lineWidth = 5;
        rctx.strokeStyle = "#0000FF";
        renderPlayer(p1, rctx);
        rctx.strokeStyle = "#FF0000";
        renderPlayer(p2, rctx);

        lctx.restore();
        rctx.restore();
    });

    lctx.lineWidth = 5;
    rctx.lineWidth = 5;
    lctx.strokeStyle = "#009900";
    rctx.strokeStyle = "#009900";
    lctx.strokeRect(testPoint.x - 5, testPoint.y - 5, 10, 10);
    rctx.strokeRect(testPoint.x - 5, testPoint.y - 5, 10, 10);
}

function renderCandies(ctx) {
    ctx.strokeStyle = "#009900";
    candies.forEach(function (candy) {
		var p = toScreenSpace(new Point(candy.x, candy.y));
        ctx.strokeRect(p.x - 10, p.y - 10, 20, 20);
    });
}

function renderGame() {
    "use strict";
    renderClear();
    setupTransform(p1, lctx);
    setupTransform(p2, rctx);

    lctx.lineWidth = 1;
    lctx.strokeStyle = "#000000";
    renderBG(lctx);
    rctx.lineWidth = 1;
    rctx.strokeStyle = "#000000";
    renderBG(rctx);

    lctx.lineWidth = 5;
    lctx.strokeStyle = "#FF0000";
    renderPlayer(p2, lctx);
    lctx.strokeStyle = "#0000FF";
    renderPlayer(p1, lctx);

    rctx.lineWidth = 5;
    rctx.strokeStyle = "#0000FF";
    renderPlayer(p1, rctx);
    rctx.strokeStyle = "#FF0000";
    renderPlayer(p2, rctx);

    lctx.strokeStyle = "#009900";
    rctx.strokeStyle = "#009900";
    lctx.strokeRect(testPoint.x - 5, testPoint.y - 5, 10, 10);
    rctx.strokeRect(testPoint.x - 5, testPoint.y - 5, 10, 10);

    renderCandies(rctx);
    renderCandies(lctx);
    renderWalls(rctx);
    renderWalls(lctx);
}

function step(time = 50) {
    main(time_old + time);
    //blank
}

function mouseEvent_to_world(mouseEvent, canvas) {
    var y = canvas.height / 2 - mouseEvent.offsetY;
    var x = mouseEvent.offsetX - canvas.width / 2;
    return new Point(x, y);
}

function snap_to_tri_grid(point) {
    var temp = Math.round(point.y / e);
    point.y = temp * e;
    if (temp & 1) {
        point.x = Math.round((point.x - t/2) / t) * t + t/2;
    } else {
        point.x = Math.round(point.x / t) * t;
    }
}

function event_mdown(mouseEvent) {
    testPoint = mouseEvent_to_world(mouseEvent, rcanvas);
    if (tracking) {
        if (mouseEvent.clientX >= rcanvas.offsetLeft) {
            testPoint = testPoint.plus(p2.screenCoord);
        } else {
            testPoint = testPoint.plus(p1.screenCoord);
        }
    }
	candies.push(new Candy(toNearestGridPoint(testPoint)));
    snap_to_tri_grid(testPoint);
}

function event_keydown(event) {
    "use strict";
    var c = String.fromCharCode(event.keyCode);
    console.log('keyCode ' + event.keyCode + ', char ' + c);
    //`t` toggles view tracking
    if (c === 'T') {
        tracking = !tracking;
    }
    //`y` toggles world tiling
    else if (c === 'Y') {
        tiling = !tiling;
    }

    //a=65; d=68; <=37; >=39;
    else if (p1.keyPress(event.keyCode)) {
        log('p1 handled key ' + c);
    }
    else if (p2.keyPress(event.keyCode)) {
        log('p2 handled key ' + c);
    }
}

function wrap_path(path) {
    var st = Math.sin(Math.PI / 3); //sin theta
    var ct = Math.cos(Math.PI / 3); //cos theta
    var tempx;
    var tempy;
    var i;
    var epsilon = 5;
    
    //Only check in the y direction 'cause it's easy.
    //  rotate by pi/3 rads to align hex edges
    for (i = 0; i < 3; i += 1) {    
        if (path.end.y > r + epsilon) {
            path.end.y -= r * 2;
            path.start.y -= r * 2;
        } else if (path.end.y < -r - epsilon) {
            path.end.y += r * 2;
            path.start.y += r * 2;
        }
        tempx = path.end.x * ct - path.end.y * st;
        tempy = path.end.x * st + path.end.y * ct;
        path.end.x = tempx;
        path.end.y = tempy;
        tempx = path.start.x * ct - path.start.y * st;
        tempy = path.start.x * st + path.start.y * ct;
        path.start.x = tempx;
        path.start.y = tempy;
    }
    //the points are rotated pi rads now. Rotate them back!
    path.end.x = -path.end.x;
    path.end.y = -path.end.y;
    path.start.x = -path.start.x;
    path.start.y = -path.start.y;

    snap_to_tri_grid(path.start);
    snap_to_tri_grid(path.end);
}

function wrap_point(p) {
    var st = Math.sin(Math.PI / 3); //sin theta
    var ct = Math.cos(Math.PI / 3); //cos theta
    var tempx;
    var tempy;
    var i;
    var epsilon = 5;
    
    //Only check in the y direction 'cause it's easy.
    //  rotate by pi/3 rads to align hex edges
    for (i = 0; i < 3; i += 1) {    
        if (p.y > r + epsilon) {
            p.y -= r * 2;
        } else if (p.y < -r - epsilon) {
            p.y += r * 2;
        }
        tempx = p.x * ct - p.y * st;
        tempy = p.x * st + p.y * ct;
        p.x = tempx;
        p.y = tempy;
    }
    //the points are rotated pi rads now. Rotate them back!
    p.x = -p.x;
    p.y = -p.y;
    snap_to_tri_grid(p);
}

function generate_random_vertex() {
    var vtx = new Point(Math.random() * r * 2, Math.random() * r * 2);
    snap_to_tri_grid(vtx);
    wrap_point(vtx);
    return vtx;
}

function update_player(player, delta) {
	var msPerEdge = 835;
	//TODO: Should player position be updated here or in physics()?
	player.step(delta/msPerEdge);
	if (player.percent_travelled < 1) return; //Player is still on current line
    //Player has reached (or passed) endVertex
    
    //Look for walls at this vertex
    
    // 4 2    1 2
    //    \  /
    //8 3 -  - 0  1
    //    /  \
    //16 4    5 32
    var wallAngles = 0;
    var turnLeft = false;
    var turnRight = false;
    var ignoringParallel = false;
    var pd = player.trajectory; //getPathAngle(player.path); // player direction
    
    var leftWall = (pd + 1) % 3; //This wall orientation # will bounce player left
    var rightWall = (pd + 2) % 3;
    var parallelWall = pd % 3;
    walls.forEach(function (wall) {
        if (player.endVertex.x == wall.x && player.endVertex.y == wall.y) {
		//(new Line(player.path.end.x, player.path.end.y, wall.x, wall.y).length < 10) {
            var o = wall.orientation;
            turnLeft |= (o == leftWall);
            turnRight|= (o == rightWall);
            ignoringParallel |= (o == parallelWall);
            
        }
    });
    if (turnRight && turnLeft) {
            //Turn around
            log('turn around');
            pd += 3;
    } else if (turnRight) {
        //Turn Right
        log('turn right');
        pd += 4; //Same as -2 in mod 6
    } else if (turnLeft) {
        //Turn Left
        log('turn left');
        pd += 2;
    }
    if (pd >= 6) pd -= 6;
	player.setTrajectory(pd);
    /*
    if (turnRight ^ turnLeft) {
        //find path ray end-start
        var ray = player.path.end.minus(player.path.start);
        //rotate path 2pi/3 rad
        var angle = 2 * Math.PI/3;
        if (turnRight) angle = -angle;
        var ct = Math.cos(angle);
        var st = Math.sin(angle);
        var tempx = ray.x * ct - ray.y * st;
        var tempy = ray.x * st + ray.y * ct;
        ray.x = tempx;
        ray.y = tempy;
        //add ray to path end
        ray = ray.plus(player.path.end);
        //new path is end to ray.
        snap_to_tri_grid(ray);
        player.path = new Line(player.path.end.x, player.path.end.y, ray.x, ray.y);
        wrap_path(player.path);
    } else if (turnRight && turnLeft) {    //Turn around
        var tmp = player.path.start;
        player.path.start = player.path.end;
        player.path.end = tmp;
    } else {        //Keep going straight
        var newEnd = player.path.end.plus(player.path.end.minus(player.path.start));
        snap_to_tri_grid(newEnd);
        player.path = new Line(player.path.end.x, player.path.end.y, newEnd.x, newEnd.y);
        wrap_path(player.path);
    }
*/
    Object.keys(player.effects).forEach(function (effect) {
        //effect is a key in the player.effects dictionary
        player.effects[effect] -= 1;
        if (player.effects[effect] <= 0) {
            
            //corner case?
            if (effect === "speedMultiplier") {
                player.speedOffset = player.speedOffset * p_default.speedMultiplier / player.speedMultiplier;
            }

            delete player.effects[effect];
            player[effect] = p_default[effect];
        }
    });

    player.effectsQueue.forEach(function (effect) {
        //testing:
        var duration = effect.duration;
        delete effect.duration;
        var power = Object.keys(effect)[0];
        var value = effect[power];
        player.effects[power] = duration;
        player[power] = value;

        //corner case?
        if (power === "speedMultiplier") {
            player.speedOffset = player.speedOffset * player.speedMultiplier / p_default.speedMultiplier;
        }
    });
    player.effectsQueue = [];
}

function collide_candies(player) {
    var pos = player.gridCoord;
    candies = candies.filter(function (candy) {
		//TODO make this test better. maybe only test when player crosses a vertex
        if ((pos.x - candy.x) * (pos.x - candy.x) + (pos.y - candy.y) * (pos.y - candy.y) < .01) {
            player.effectsQueue.push(candy.effect);
            return false;
        }
        return true;
    });
}

function physics(delta) {
    "use strict";

    collide_candies(p1);
    collide_candies(p2);

    update_player(p1, delta);
    update_player(p2, delta);
    
    update_walls(delta);
}

function mainloop_init(timestamp) {
    time_old = timestamp;
    window.requestAnimationFrame(mainloop);
}

function mainloop(timestamp) {
    "use strict";
    var delta = timestamp - time_old;
    time_old = timestamp;

    physics(delta);

    if (tiling) {
        renderTiledGame();
    } else {
        renderGame();
    }
    window.requestAnimationFrame(mainloop);
}

//To save on typing
var log = console.log;