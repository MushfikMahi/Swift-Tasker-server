const express = require("express");
const app = express();
require("dotenv").config();
const cors = require("cors");
const cookieParser = require("cookie-parser");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 8000;
const corsOption = {
  origin: [
    "http://localhost:5173",
    "http://localhost:5174",
    "https://swift-tasker.web.app",
  ],
  credentials: true,
  optionSuccessStatus: 200,
};
app.use(cors(corsOption));
app.use(express.json());
app.use(cookieParser());

// Verify Token Middleware
const verifyToken = async (req, res, next) => {
  const token = req.cookies?.token;
  // console.log(token);
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.user = decoded;
    next();
  });
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.04rw29h.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    const usersCollection = client.db("SwiftTasker").collection("users");
    const tasksCollection = client.db("SwiftTasker").collection("tasks");
    const futuresCollection = client.db("SwiftTasker").collection("future");
    const testimonyCollection = client
      .db("SwiftTasker")
      .collection("testimony");
    const submittedCollection = client
      .db("SwiftTasker")
      .collection("submissions");
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });

    // verify admin middleware
    const verifyAdmin = async (req, res, next) => {
      const user = req.user;
      // console.log("user from admin", req.body);
      const query = { email: user?.email };
      const result = await usersCollection.findOne(query);
      // console.log(result?.role);
      if (!result || result?.role !== "Admin")
        return res.status(401).send({ message: "unauthorized access!!" });

      next();
    };

    // verify TaskCreator middleware
    const verifyTaskCreator = async (req, res, next) => {
      const user = req.user;
      // console.log("task body", req.body);
      // console.log("task user", req);
      const query = { email: user?.email };
      const result = await usersCollection.findOne(query);
      // console.log(result?.role);
      if (!result || result?.role !== "TaskCreator") {
        return res.status(401).send({ message: "unauthorized access!!" });
      }

      next();
    };

    // admin states
    app.get("/admin-stats", verifyToken, verifyAdmin, async (req, res) => {
      const users = await usersCollection.estimatedDocumentCount();
      const totalCoin = await usersCollection
        .aggregate([
          {
            $group: {
              _id: null,
              total: { $sum: "$coin" },
            },
          },
        ])
        .toArray();
      res.send({ users, totalCoin });
    });

    // TaskCreator State
    app.get(
      "/taskCreator-state/:email",
      verifyToken,
      verifyTaskCreator,
      async (req, res) => {
        const email = req.params.email;
        const quantity = await tasksCollection
          .aggregate([
            {
              $match: {
                "task_creator.email": email,
              },
            },
            {
              $group: {
                _id: "$task_creator.email",
                totalQuantity: { $sum: "$task_quantity" },
              },
            },
          ])
          .toArray();
        // const query = { "task_creator.email": email };
        const coin = await usersCollection.findOne(
          { email: email },
          { projection: { coin: 1 } }
        );
        res.send({ quantity, coin });
      }
    );

    // worker state
    app.get("/worker-state/:email", async (req, res) => {
      const email = req.params.email;
      const coin = await usersCollection.findOne(
        { email: email },
        { projection: { coin: 1 } }
      );
      const totalSubmission = await submittedCollection.countDocuments({
        "worker_info.email": email,
      });
      res.send({ coin, totalSubmission });
    });

    // auth related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "365d",
      });
      res
        .cookie("token", token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
        })
        .send({ success: true });
    });

    // Logout
    app.get("/logout", async (req, res) => {
      try {
        res
          .clearCookie("token", {
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
            sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
          })
          .send({ success: true });
        // console.log("Logout successful");
      } catch (err) {
        res.status(500).send(err);
      }
    });

    // get the approved data for the worker
    app.get("/approved/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const filter = { "worker_info.email": email, status: "Approved" };
      const result = await submittedCollection.find(filter).toArray();
      res.send(result);
    });

    // save a user data in db
    app.put("/user", async (req, res) => {
      const user = req.body;

      const query = { email: user?.email };
      // check if user already exists in db
      const isExist = await usersCollection.findOne(query);
      if (isExist) {
        if (user.status === "Requested") {
          // if existing user try to change his role
          const result = await usersCollection.updateOne(query, {
            $set: { status: user?.status },
          });
          return res.send(result);
        } else {
          // if existing user login again
          return res.send(isExist);
        }
      }

      // save user for the first time
      const options = { upsert: true };
      const updateDoc = {
        $set: {
          ...user,
          timestamp: Date.now(),
        },
      };
      const result = await usersCollection.updateOne(query, updateDoc, options);
      res.send(result);
    });

    // get all the worker
    app.get("/worker", async (req, res) => {
      const query = { role: "Worker" };
      const result = await usersCollection.find(query).toArray();
      res.send(result);
    });

    // update user role
    app.patch("/worker/:id", async (req, res) => {
      const { newRole } = req.body;
      const id = req.params.id;
      const filter = { _id: new ObjectId(id) };
      // console.log("New Coin:", newRole);
      const updatedRole = {
        $set: {
          role: newRole,
        },
      };
      const result = await usersCollection.updateOne(filter, updatedRole);
      res.send(result);
    });

    // get a user info by email from db
    app.get("/user/:email", async (req, res) => {
      const email = req.params.email;
      const result = await usersCollection.findOne({ email });
      res.send(result);
    });

    // send a task to the db
    app.post("/task", verifyToken, verifyTaskCreator, async (req, res) => {
      const task = req.body;
      const result = await tasksCollection.insertOne(task);
      res.send(result);
    });

    // update the coin when created a task
    app.patch("/user/:email", async (req, res) => {
      const { newCoin } = req.body;
      const email = req.params.email;
      const filter = { email: email };
      // console.log("New Coin:", newCoin);
      const updatedCoin = {
        $set: {
          coin: newCoin,
        },
      };
      const result = await usersCollection.updateOne(filter, updatedCoin);
      res.send(result);
    });

    // get taskcreator task by email
    app.get(
      "/tasks/:email",
      verifyToken,
      verifyTaskCreator,
      async (req, res) => {
        const email = req.params.email;

        const result = await tasksCollection
          .find({ "task_creator.email": email })
          .sort({ created_at: -1 })
          .toArray();
        res.send(result);
      }
    );

    // get Applyed task
    app.get(
      "/submitted/:email",
      verifyToken,
      verifyTaskCreator,
      async (req, res) => {
        const email = req.params.email;
        const result = await submittedCollection
          .find({ "task_creator.email": email })
          .toArray();
        res.send(result);
      }
    );

    // update the status
    app.patch(
      "/submissionMark/:id",
      verifyToken,
      verifyTaskCreator,
      async (req, res) => {
        const { newStatus } = req.body;
        const id = req.params.id;
        const filter = { _id: new ObjectId(id) };
        // console.log("New status:", newStatus, id);
        const updatedStatus = {
          $set: {
            status: newStatus,
          },
        };
        const result = await submittedCollection.updateOne(
          filter,
          updatedStatus
        );
        res.send(result);
      }
    );

    // delete a data from my task
    app.delete("/delete/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await tasksCollection.deleteOne(query);
      res.send(result);
    });

    // delete a user
    app.delete("/userdelete/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await usersCollection.deleteOne(query);
      res.send(result);
    });

    // update a data from
    app.put("/update/:id", verifyToken, verifyTaskCreator, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const options = { upsert: true };
      const { updatedTask } = req.body;
      const updatedDoc = {
        $set: {
          task_title: updatedTask.task_title,
          task_detail: updatedTask.task_detail,
          submission_info: updatedTask.submission_info,
        },
      };
      const result = await tasksCollection.updateOne(
        query,
        updatedDoc,
        options
      );
      res.send(result);
    });

    // get all the task data
    app.get("/tasks", async (req, res) => {
      const result = await tasksCollection.find().toArray();
      res.send(result);
    });

    // get all the future data
    app.get("/future", async (req, res) => {
      const result = await futuresCollection.find().toArray();
      res.send(result);
    });

    // get all the testimony data
    app.get("/testimony", async (req, res) => {
      const result = await testimonyCollection.find().toArray();
      res.send(result);
    });

    // get task detail
    app.get("/task/:id", async (req, res) => {
      const id = req.params.id;
      // console.log("the id", id);
      const query = { _id: new ObjectId(id) };
      const result = await tasksCollection.findOne(query);
      res.send(result);
    });

    // send a submitted task to the db
    app.post("/submission", verifyToken, async (req, res) => {
      const task = req.body;
      const result = await submittedCollection.insertOne(task);
      res.send(result);
    });

    // get all the submitted task data my email
    app.get("/submission/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      const result = await submittedCollection
        .find({ "worker_info.email": email })
        .toArray();
      res.send(result);
    });

    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("Hello from SwiftTasker Server..");
});

app.listen(port, () => {
  console.log(`SwiftTasker is running on port ${port}`);
});
