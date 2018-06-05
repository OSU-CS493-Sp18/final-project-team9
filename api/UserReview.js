const router = require('express').Router();
const validation = require('../lib/validation');

/*
 * Schema describing required/optional fields of a review object.
 */
const reviewSchema = {
  username: { required: true },
  gameID: { required: true },
  score: { required: true },
  datePosted: { required: true },
  reviewContent: { required: true }
};


/*
 * Executes a MySQL query to verfy whether a given user has already reviewed
 * a specified business.  Returns a Promise that resolves to true if the
 * specified user has already reviewed the specified business or false
 * otherwise.
 */
function hasUserReviewedGame(userName, gameid, mysqlPool) {
  return new Promise((resolve, reject) => {
    mysqlPool.query(
      'SELECT COUNT(*) AS count FROM UserReview WHERE username = ? AND gameID = ?',
      [ userName, gameid ],
      function (err, results) {
        if (err) {
          reject(err);
        } else {
          resolve(results[0].count > 0);
        }
      }
    );
  });
}

/*
 * Executes a MySQL query to insert a new review into the database.  Returns
 * a Promise that resolves to the ID of the newly-created review entry.
 */
function insertNewReview(review, mysqlPool) {
  return new Promise((resolve, reject) => {
    review = validation.extractValidFields(review, reviewSchema);
    review.id = null;
    mysqlPool.query(
      'INSERT INTO UserReview SET ?',
      review,
      function (err, result) {
        if (err) {
          reject(err);
        } else {
          resolve(result.insertId);
        }
      }
    );
  });
}

/*
 * Route to create a new review.
 */
router.post('/', function (req, res, next) {
  const mysqlPool = req.app.locals.mysqlPool;
  if (validation.validateAgainstSchema(req.body, reviewSchema)) {
    /*
     * Make sure the user is not trying to review the same business twice.
     * If they're not, then insert their review into the DB.
     */
    hasUserReviewedGame(req.body.username, req.body.gameID, mysqlPool)
      .then((userReviewedThisGameAlready) => {
        if (userReviewedThisGameAlready) {
          return Promise.reject(403);
        } else {
          return insertNewReview(review, mysqlPool);
        }
      })
      .then((id) => {
        res.status(201).json({
          id: id,
          links: {
            review: `/UserReview/${id}`,
            game: `/games/${req.body.gameID}`
          }
        });
      })
      .catch((err) => {
        if (err === 403) {
          res.status(403).json({
            error: "User has already posted a review of this game"
          });
        } else {
          res.status(500).json({
            error: "Error inserting review into DB.  Please try again later."
          });
        }
      });
  } else {
    res.status(400).json({
      error: "Request body is not a valid review object."
    });
  }
});

/*
 * Executes a MySQL query to fetch a single specified review based on its ID.
 * Returns a Promise that resolves to an object containing the requested
 * review.  If no review with the specified ID exists, the returned Promise
 * will resolve to null.
 */
function getReviewByID(reviewID, mysqlPool) {
  return new Promise((resolve, reject) => {
    mysqlPool.query('SELECT * FROM UserReview WHERE id = ?', [ reviewID ], function (err, results) {
      if (err) {
        reject(err);
      } else {
        resolve(results[0]);
      }
    });
  });
}

/*
 * Route to fetch info about a specific review.
 */
router.get('/:reviewID', function (req, res, next) {
  const mysqlPool = req.app.locals.mysqlPool;
  const reviewID = parseInt(req.params.reviewID);
  getReviewByID(reviewID, mysqlPool)
    .then((review) => {
      if (review) {
        res.status(200).json(review);
      } else {
        next();
      }
    })
    .catch((err) => {
      res.status(500).json({
        error: "Unable to fetch review.  Please try again later."
      });
    });
});

/*
 * Executes a MySQL query to replace a specified review with new data.
 * Returns a Promise that resolves to true if the review specified by
 * `reviewID` existed and was successfully updated or to false otherwise.
 */
function replaceReviewByID(reviewID, review, mysqlPool) {
  return new Promise((resolve, reject) => {
    review = validation.extractValidFields(review, reviewSchema);
    mysqlPool.query('UPDATE UserReview SET ? WHERE id = ?', [ review, reviewID ], function (err, result) {
      if (err) {
        reject(err);
      } else {
        resolve(result.affectedRows > 0);
      }
    });
  });
}

/*
 * Route to update a review.
 */
router.put('/:reviewID', function (req, res, next) {
  const mysqlPool = req.app.locals.mysqlPool;
  const reviewID = parseInt(req.params.reviewID);
  if (validation.validateAgainstSchema(req.body, reviewSchema)) {
    let updatedReview = validation.extractValidFields(req.body, reviewSchema);
    /*
     * Make sure the updated review has the same businessID and username as
     * the existing review.  If it doesn't, respond with a 403 error.  If the
     * review doesn't already exist, respond with a 404 error.
     */
    getReviewByID(reviewID, mysqlPool)
      .then((existingReview) => {
        if (existingReview) {
          if (updatedReview.gameID === existingReview.gameID && updatedReview.username === existingReview.username) {
            return replaceReviewByID(reviewID, updatedReview, mysqlPool);
          } else {
            return Promise.reject(403);
          }
        } else {
          next();
        }
      })
      .then((updateSuccessful) => {
        if (updateSuccessful) {
          res.status(200).json({
            links: {
              game: `/games/${updatedReview.gameID}`,
              review: `/UserReview/${reviewID}`
            }
          });
        } else {
          next();
        }
      })
      .catch((err) => {
        if (err === 403) {
          res.status(403).json({
            error: "Updated review must have the same gameID and username"
          });
        } else {
          res.status(500).json({
            error: "Unable to update review.  Please try again later."
          });
        }
      });
  } else {
    res.status(400).json({
      error: "Request body is not a valid review object."
    });
  }
});

/*
 * Executes a MySQL query to delete a review specified by its ID.  Returns
 * a Promise that resolves to true if the review specified by `reviewID`
 * existed and was successfully deleted or to false otherwise.
 */
function deleteReviewByID(reviewID, mysqlPool) {
  return new Promise((resolve, reject) => {
    mysqlPool.query('DELETE FROM UserReview WHERE id = ?', [ reviewID ], function (err, result) {
      if (err) {
        reject(err);
      } else {
        resolve(result.affectedRows > 0);
      }
    });
  });

}

/*
 * Route to delete a review.
 */
router.delete('/:reviewID', function (req, res, next) {
  const mysqlPool = req.app.locals.mysqlPool;
  const reviewID = parseInt(req.params.reviewID);
  deleteReviewByID(reviewID, mysqlPool)
    .then((deleteSuccessful) => {
      if (deleteSuccessful) {
        res.status(204).end();
      } else {
        next();
      }
    })
    .catch((err) => {
      res.status(500).json({
        error: "Unable to delete review.  Please try again later."
      });
    });
});

/*
 * Executes a MySQL query to fetch all reviews for a specified business, based
 * on the business's ID.  Returns a Promise that resolves to an array
 * containing the requested reviews.  This array could be empty if the
 * specified business does not have any reviews.  This function does not verify
 * that the specified business ID corresponds to a valid business.
 */
function getReviewsByGameID(gameid, mysqlPool) {
  return new Promise((resolve, reject) => {
    mysqlPool.query(
      'SELECT * FROM UserReview WHERE gameID = ?',
      [ gameid ],
      function (err, results) {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      }
    );
  });
}

/*
 * Executes a MySQL query to fetch all reviews by a specified user, based on
 * on the user's ID.  Returns a Promise that resolves to an array containing
 * the requested reviews.  This array could be empty if the specified user
 * does not have any reviews.  This function does not verify that the specified
 * user ID corresponds to a valid user.
 */
function getReviewsByUserID(userName, mysqlPool) {
  return new Promise((resolve, reject) => {
    mysqlPool.query(
      'SELECT * FROM UserReview WHERE username = ?',
      [ userName ],
      function (err, results) {
        if (err) {
          reject(err);
        } else {
          resolve(results);
        }
      }
    );
  });
}

exports.router = router;
exports.getReviewsByGameID = getReviewsByGameID;
exports.getReviewsByUserID = getReviewsByUserID;
